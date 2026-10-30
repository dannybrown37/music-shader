/**
 * Renders stills of the running dev server in headless Chrome (software GL) for visual checks.
 *
 *   npm run dev   # in another terminal
 *   node tools/shot.ts --track "Haus of You [2019, edm].mp3" --t 45 --scene nebula --out out/nebula.png
 *
 * Several --t values may be given as a comma list; each gets its own file (name-<t>.png).
 * --sheet N renders N consecutive frames from --t into one 4-column contact sheet.
 * --export S encodes S seconds from --t to an .mp4 (WebCodecs) instead of taking a screenshot.
 * --art /out/cover.png and --lrc /out/song.lrc load cover art and lyrics (URLs on the dev server);
 * --thumbnail renders the YouTube thumbnail (use --w 1280 --h 720); --poster the song's Portrait poster.
 * --ui --live song.wav runs the live-input path with the WAV as a fake microphone (add --hud for meters).
 * --ui --keys TD presses each character as a key (1.5 s apart) before the screenshot;
 *   named keys go in braces: --keys "{Space}4K{ArrowRight}2K".
 * --ui --welcome opens the app with no track (the start screen); --mobile emulates a touch phone
 *   (use --w 390 --h 844); --click "#a,.b" clicks each selector (1 s apart) before the screenshot.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { launchChrome } from "./chrome.ts";

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
      art: { type: "string" },
      lrc: { type: "string" },
      thumbnail: { type: "boolean", default: false },
      poster: { type: "boolean", default: false },
      ui: { type: "boolean", default: false },
      sheet: { type: "string", default: "0" },
      set: { type: "string" },
      export: { type: "string" },
      live: { type: "string" },
      hud: { type: "boolean", default: false },
      keys: { type: "string" },
      welcome: { type: "boolean", default: false },
      mobile: { type: "boolean", default: false },
      click: { type: "string" },
      out: { type: "string", default: "out/shot.png" },
      base: { type: "string", default: "http://127.0.0.1:5173" },
      timeout: { type: "string", default: "240" },
    },
  });
  const fakeMic = values.live ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${values.live}`] : [];
  const { cdp, close } = await launchChrome(Number(values.w), Number(values.h), fakeMic);
  try {
    if (values.ui) {
      // The live app: load the track, let the UI settle, capture whatever is on screen.
      const q = new URLSearchParams(values.live ? { live: "mic", scene: values.scene } : values.welcome ? {} : { track: values.track, scene: values.scene });
      if (values.hud) q.set("hud", "1");
      if (values.mobile) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: Number(values.w), height: Number(values.h), deviceScaleFactor: 2, mobile: true });
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      }
      await cdp.send("Page.navigate", { url: `${values.base}/?${q}` });
      await new Promise((r) => setTimeout(r, Number(values.timeout) * 1000));
      for (const [token, named] of (values.keys ?? "").matchAll(/\{(\w+)\}|./g)) {
        const key = named === "Space" ? " " : (named ?? token);
        const code = named ?? (key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : undefined);
        const text = key.length === 1 ? key : undefined;
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
        await new Promise((r) => setTimeout(r, 1500));
      }
      for (const selector of (values.click ?? "").split(",").filter(Boolean)) {
        await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
        await new Promise((r) => setTimeout(r, 1000));
      }
      const shot = (await cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
      mkdirSync(dirname(values.out), { recursive: true });
      writeFileSync(values.out, Buffer.from(shot.data, "base64"));
      console.log(`wrote ${values.out}`);
      if (cdp.logs.length > 0) console.log(`console:\n${cdp.logs.join("\n")}`);
      return;
    }
    for (const t of values.t.split(",")) {
      const q = new URLSearchParams({ still: "1", track: values.track, t, scene: values.scene, w: values.w, h: values.h, warm: values.warm, fps: values.fps });
      if (values.set) q.set("set", values.set);
      if (values.title) q.set("title", "1");
      if (values.art) q.set("art", values.art);
      if (values.lrc) q.set("lrc", values.lrc);
      if (values.thumbnail) q.set("thumbnail", "1");
      if (values.poster) q.set("poster", "1");
      if (values.export) q.set("export", values.export);
      const sheet = Number(values.sheet);
      if (sheet > 0) {
        q.set("sheet", String(sheet));
        const rows = Math.ceil(sheet / 4);
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: Number(values.w) * 4, height: Number(values.h) * rows, deviceScaleFactor: 1, mobile: false });
      }
      await cdp.send("Page.navigate", { url: `${values.base}/?${q}` });
      const title = await cdp.waitForTitle(Number(values.timeout));
      if (title !== "ready") {
        console.error(`t=${t}: page ended with title "${title}"\n${cdp.logs.join("\n")}`);
        process.exitCode = 1;
        continue;
      }
      if (values.export) {
        const [b64, ms] = (await cdp.evaluate<[string, number]>("[window.__export, window.__exportMs]")) ?? ["", 0];
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
  } finally {
    close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
