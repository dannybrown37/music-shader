/** Headless Chrome with software WebGL (SwiftShader), driven over the DevTools protocol. Shared by shot.ts and smoke.ts. */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9333;

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
}

export class Cdp {
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

  async evaluate<T>(expression: string): Promise<T | undefined> {
    const r = (await this.send("Runtime.evaluate", { expression, returnByValue: true })) as { result?: { value?: T } };
    return r.result?.value;
  }

  /** Polls document.title until it is "ready" or "error" (the app's still/smoke modes set it); returns it. */
  async waitForTitle(timeoutSeconds: number): Promise<string> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    let title = "";
    while (Date.now() < deadline) {
      title = (await this.evaluate<string>("document.title")) ?? "";
      if (title === "ready" || title === "error") break;
      await new Promise((res) => setTimeout(res, 250));
    }
    return title;
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

/** Starts Chrome and connects; call `close()` when done. `CHROME` overrides the binary. */
export async function launchChrome(width: number, height: number, extraArgs: string[] = []): Promise<{ cdp: Cdp; close: () => void }> {
  const chrome = spawn(
    process.env.CHROME ?? "google-chrome",
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), "shot-"))}`,
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--autoplay-policy=no-user-gesture-required",
      `--window-size=${width},${height}`,
      ...extraArgs,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  try {
    const cdp = await Cdp.connect(await waitForTarget());
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    return {
      cdp,
      close: (): void => {
        cdp.close();
        chrome.kill();
      },
    };
  } catch (err: unknown) {
    chrome.kill();
    throw err;
  }
}
