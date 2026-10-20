import type { Settings } from "./settings.ts";

/**
 * Presets as links: the settings JSON, base64url-encoded into the URL hash, so a look can be
 * shared without a file. The receiver runs it through mergeSettings, which drops anything invalid.
 */
export const SHARE_PREFIX = "look=";
const MAX_HASH = 30_000;

export function encodeShare(s: Settings): string {
  const overlay: Partial<Settings["overlay"]> = { ...s.overlay };
  delete overlay.title;
  delete overlay.subtitle;
  delete overlay.showHud;
  const json = JSON.stringify({ ...s, overlay });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return SHARE_PREFIX + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The shared settings in `hash` (untrusted: merge, don't assign), or null if it isn't a share link. */
export function decodeShare(hash: string): unknown {
  const body = hash.replace(/^#/, "");
  if (!body.startsWith(SHARE_PREFIX) || body.length > MAX_HASH) return null;
  try {
    const binary = atob(body.slice(SHARE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}
