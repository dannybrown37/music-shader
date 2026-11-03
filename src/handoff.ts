/**
 * Receives a video + its mastered WAV from Master Kit (opened as `/?handoff=1` by its "Open in Music Shader").
 *
 *   master-kit ──window.open──► us: post HANDOFF_READY to window.opener
 *   master-kit ◄──────────────── checks our origin, then posts {type: "music-shader:handoff", v: 1, name, video, audio}
 */
export const HANDOFF_READY = { type: "music-shader:ready", v: 1 } as const;

const SENDERS: Record<string, string> = {
  "https://shader.dannybrown.dev": "https://master.dannybrown.dev",
  "http://127.0.0.1:5173": "http://127.0.0.1:5174",
  "http://localhost:5173": "http://localhost:5174",
};

/** The only origin allowed to hand files to this one, or null where handoff isn't offered. */
export function senderOriginFor(origin: string): string | null {
  return Object.hasOwn(SENDERS, origin) ? SENDERS[origin] : null;
}

export interface Handoff {
  video: File;
  soundtrack: File;
}

export function parseHandoff(data: unknown): Handoff | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  const { name, video, audio } = d;
  if (d.type !== "music-shader:handoff" || d.v !== 1 || typeof name !== "string" || name === "") return null;
  if (!(video instanceof Blob) || !(audio instanceof Blob) || video.size === 0 || audio.size === 0) return null;
  return {
    video: video instanceof File && video.name === name ? video : new File([video], name, { type: video.type }),
    soundtrack: new File([audio], `${name.replace(/\.[^.]+$/, "")}.master.wav`, { type: audio.type || "audio/wav" }),
  };
}

/** Says ready to the opener and resolves with the first valid handoff from the expected sender. */
export function receiveHandoff(win: Window): Promise<Handoff> {
  const sender = senderOriginFor(win.location.origin);
  const opener = win.opener as Window | null;
  if (!sender || !opener) return Promise.reject(new Error("Open this from Master Kit's \"Open in Music Shader\""));
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent): void => {
      if (e.origin !== sender || e.source !== opener) return;
      const handoff = parseHandoff(e.data);
      if (!handoff) return;
      win.removeEventListener("message", onMessage);
      resolve(handoff);
    };
    win.addEventListener("message", onMessage);
    opener.postMessage(HANDOFF_READY, sender);
  });
}
