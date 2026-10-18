import { SCENES } from "./render/scenes/index.ts";
import { defaultSettings, mergeSettings } from "./settings.ts";
import type { Settings } from "./settings.ts";

/** Built-in presets: one per scene using the look it was designed around, plus any hand-tuned extras. */
export function builtinPresets(): Record<string, Settings> {
  const out: Record<string, Settings> = {};
  for (const scene of SCENES) {
    const base = defaultSettings();
    out[scene.name] = mergeSettings(base, {
      scene: scene.id,
      palette: scene.palette,
      look: scene.look,
      sceneParams: { [scene.id]: Object.fromEntries(scene.params.map((p) => [p.key, p.value])) },
    });
  }
  return out;
}

const STORAGE_KEY = "music-shader:presets";
const CURRENT_KEY = "music-shader:current";

export function loadUserPresets(): Record<string, Settings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, Settings> = {};
    for (const [name, value] of Object.entries(parsed)) out[name] = mergeSettings(defaultSettings(), value);
    return out;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) return {};
    throw err;
  }
}

export function saveUserPresets(presets: Record<string, Settings>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function loadCurrent(): Settings | null {
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    return raw ? mergeSettings(defaultSettings(), JSON.parse(raw)) : null;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

export function saveCurrent(s: Settings): void {
  localStorage.setItem(CURRENT_KEY, JSON.stringify(s));
}

/** Fill in any scene params the settings don't have yet with the scene's defaults. */
export function sceneParamsFor(s: Settings, sceneId: string): Record<string, number> {
  const scene = SCENES.find((x) => x.id === sceneId);
  const stored = (s.sceneParams[sceneId] ??= {});
  for (const p of scene?.params ?? []) if (!(p.key in stored)) stored[p.key] = p.value;
  return stored;
}
