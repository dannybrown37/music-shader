/**
 * CI check that every scene's shader compiles and draws a frame, in headless Chrome with
 * software WebGL. Needs a server: `just dev`, or `npm run build && npx vite preview`.
 *
 *   node tools/smoke.ts [--base http://127.0.0.1:5173]
 *
 * Exits 1 if the app fails to start or any scene fails.
 */
import { parseArgs } from "node:util";
import { launchChrome } from "./chrome.ts";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "http://127.0.0.1:5173" },
      timeout: { type: "string", default: "180" },
    },
  });
  const { cdp, close } = await launchChrome(320, 180);
  try {
    await cdp.send("Page.navigate", { url: `${values.base}/?smoke` });
    const title = await cdp.waitForTitle(Number(values.timeout));
    const results = (await cdp.evaluate<{ id: string; error: string }[]>("window.__smoke")) ?? [];
    if (title !== "ready" || results.length === 0) {
      console.error(`The app did not start (title "${title}"):\n${cdp.logs.join("\n")}`);
      process.exitCode = 1;
      return;
    }
    for (const r of results) console.log(`${r.error ? "FAIL" : "ok  "} ${r.id}${r.error ? `\n     ${r.error.replace(/\n/g, "\n     ")}` : ""}`);
    const failed = results.filter((r) => r.error).length;
    console.log(failed ? `${failed} of ${results.length} scenes failed` : `all ${results.length} scenes compile and draw`);
    if (failed) process.exitCode = 1;
  } finally {
    close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
