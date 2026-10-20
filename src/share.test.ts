import { describe, expect, it } from "vitest";
import { decodeShare, encodeShare, SHARE_PREFIX } from "./share.ts";
import { defaultSettings, mergeSettings } from "./settings.ts";

describe("share links", () => {
  it("round-trips the look through a URL hash", () => {
    const s = defaultSettings();
    s.scene = "tunnel";
    s.palette = "Neon";
    s.reactivity.kick = 2.25;
    s.sceneParams.tunnel = { speed: 1.7 };
    const hash = `#${encodeShare(s)}`;
    const back = mergeSettings(defaultSettings(), decodeShare(hash));
    expect(back.scene).toBe("tunnel");
    expect(back.palette).toBe("Neon");
    expect(back.reactivity.kick).toBe(2.25);
    expect(back.sceneParams.tunnel.speed).toBe(1.7);
  });

  it("leaves the song's title and the debug meters out of the link", () => {
    const s = defaultSettings();
    s.overlay.title = "My Unreleased Song";
    s.overlay.subtitle = "demo";
    s.overlay.showHud = true;
    const decoded = decodeShare(`#${encodeShare(s)}`) as { overlay: Record<string, unknown> };
    expect(decoded.overlay.title).toBeUndefined();
    expect(decoded.overlay.subtitle).toBeUndefined();
    expect(decoded.overlay.showHud).toBeUndefined();
  });

  it("uses only URL-safe characters", () => {
    expect(encodeShare(defaultSettings())).toMatch(new RegExp(`^${SHARE_PREFIX}[A-Za-z0-9_-]+$`));
  });

  it.each([
    ["an empty hash", ""],
    ["another hash", "#section-2"],
    ["broken base64", `#${SHARE_PREFIX}%%%`],
    ["base64 that isn't JSON", `#${SHARE_PREFIX}bm90IGpzb24`],
    ["an oversized link", `#${SHARE_PREFIX}${"A".repeat(40_000)}`],
  ])("ignores %s", (_, hash) => {
    expect(decodeShare(hash)).toBeNull();
  });
});
