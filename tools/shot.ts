/**
 * Renders stills of the running dev server in headless Chrome (software GL) for visual checks.
 *
 *   npm run dev   # in another terminal
 *   node tools/shot.ts --track "Haus of You [2019, edm].mp3" --t 45 --scene nebula --out out/nebula.png
 *
 * Several --t values may be given as a comma list; each gets its own file (name-<t>.png).
 * --sheet N renders N consecutive frames from --t into one 4-column contact sheet.
 * --export S encodes S seconds from --t to an .mp4 (WebCodecs) instead of taking a screenshot.
 * --ui --live song.wav runs the live-input path with the WAV as a fake microphone (add --hud for meters).
 * --ui --keys TD presses each character as a key (1.5 s apart) before the screenshot.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

const PORT = 9333;

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
}

class Cdp {
  private readonly ws: WebSocket;
  private next = 1;
  private readonly pending = new Map<number, (m: CdpMessage) => void>();
  readonly logs: string[] = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev: MessageEvent): void => {
      const msg = JSON.parse(String(ev.data)) as CdpMessage;
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)?.(msg);
        this.pending.delete(msg.id);
      } else if (msg.method === "Runtime.consoleAPICalled" || msg.method === "Runtime.exceptionThrown") {
        this.logs.push(JSON.stringify(msg.params).slice(0, 600));
      }
    };
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = (): void => resolve();
      ws.onerror = (): void => reject(new Error(`could not connect to ${url}`));
    });
    return new Cdp(ws);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.next++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result ?? {})));
    });
  }

  close(): void {
    this.ws.close();
  }
}

async function waitForTarget(): Promise<string> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = (await res.json()) as { type: string; webSocketDebuggerUrl: string }[];
      const page = targets.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch (err: unknown) {
      if (!(err instanceof TypeError)) throw err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Chrome did not start");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      track: { type: "string", default: "Haus of You [2019, edm].mp3" },
      t: { type: "string", default: "45" },
      scene: { type: "string", default: "nebula" },
      w: { type: "string", default: "640" },
      h: { type: "string", default: "360" },
      warm: { type: "string", default: "0.5" },
      fps: { type: "string", default: "30" },
      title: { type: "boolean", default: false },
      ui: { type: "boolean", default: false },
      sheet: { type: "string", default: "0" },
      set: { type: "string" },
      export: { type: "string" },
      live: { type: "string" },
      hud: { type: "boolean", default: false },
      keys: { type: "string" },
      out: { type: "string", default: "out/shot.png" },
      base: { type: "string", default: "http://127.0.0.1:5173" },
      timeout: { type: "string", default: "240" },
    },
  });
  const chrome = spawn(
    "google-chrome",
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), "shot-"))}`,
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--autoplay-policy=no-user-gesture-required",
      `--window-size=${values.w},${values.h}`,
      ...(values.live ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${values.live}`] : []),
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  try {
    const cdp = await Cdp.connect(await waitForTarget());
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: Number(values.w), height: Number(values.h), deviceScaleFactor: 1, mobile: false });
    if (values.ui) {
      // The live app: load the track, let the UI settle, capture whatever is on screen.
      const q = new URLSearchParams(values.live ? { live: "mic", scene: values.scene } : { track: values.track, scene: values.scene });
      if (values.hud) q.set("hud", "1");
      await cdp.send("Page.navigate", { url: `${values.base}/?${q}` });
      await new Promise((r) => setTimeout(r, Number(values.timeout) * 1000));
      for (const key of values.keys ?? "") {
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, text: key });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key });
        await new Promise((r) => setTimeout(r, 1500));
      }
      const shot = (await cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
      mkdirSync(dirname(values.out), { recursive: true });
      writeFileSync(values.out, Buffer.from(shot.data, "base64"));
      console.log(`wrote ${values.out}`);
      if (cdp.logs.length > 0) console.log(`console:\n${cdp.logs.join("\n")}`);
      cdp.close();
      return;
    }
    for (const t of values.t.split(",")) {
      const q = new URLSearchParams({ still: "1", track: values.track, t, scene: values.scene, w: values.w, h: values.h, warm: values.warm, fps: values.fps });
      if (values.set) q.set("set", values.set);
      if (values.title) q.set("title", "1");
      if (values.export) q.set("export", values.export);
      const sheet = Number(values.sheet);
      if (sheet > 0) {
        q.set("sheet", String(sheet));
        const rows = Math.ceil(sheet / 4);
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: Number(values.w) * 4, height: Number(values.h) * rows, deviceScaleFactor: 1, mobile: false });
      }
      await cdp.send("Page.navigate", { url: `${values.base}/?${q}` });
      const deadline = Date.now() + Number(values.timeout) * 1000;
      let title = "";
      while (Date.now() < deadline) {
        const r = (await cdp.send("Runtime.evaluate", { expression: "document.title", returnByValue: true })) as { result?: { value?: string } };
        title = r.result?.value ?? "";
        if (title === "ready" || title === "error") break;
        await new Promise((res) => setTimeout(res, 250));
      }
      if (title !== "ready") {
        console.error(`t=${t}: page ended with title "${title}"\n${cdp.logs.join("\n")}`);
        process.exitCode = 1;
        continue;
      }
      if (values.export) {
        const r = (await cdp.send("Runtime.evaluate", { expression: "[window.__export, window.__exportMs]", returnByValue: true })) as { result: { value: [string, number] } };
        const [b64, ms] = r.result.value;
        const out = values.out.replace(/\.png$/, ".mp4");
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, Buffer.from(b64, "base64"));
        console.log(`wrote ${out} (encoded in ${(ms / 1000).toFixed(1)}s)`);
        continue;
      }
      const shot = (await cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
      const many = values.t.includes(",");
      const out = many ? values.out.replace(/\.png$/, `-${t}.png`) : values.out;
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(shot.data, "base64"));
      console.log(`wrote ${out}`);
    }
    if (cdp.logs.length > 0) console.log(`console:\n${cdp.logs.join("\n")}`);
    cdp.close();
  } finally {
    chrome.kill();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
