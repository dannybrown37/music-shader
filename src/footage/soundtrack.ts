import { isVideoFile } from "./video.ts";

/** AAC priming and container rounding shift a muxed track by tens of ms; more than this is a different edit. */
export const SOUNDTRACK_TOLERANCE = 0.1;

interface NamedFile {
  name: string;
  type: string;
}

function minutes(t: number): string {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** Why a separately mastered soundtrack can't replace a video's audio, or null when it fits. */
export function soundtrackMismatch(audioSeconds: number, videoSeconds: number): string | null {
  if (!Number.isFinite(videoSeconds)) return "Couldn't read the video's length";
  if (Math.abs(audioSeconds - videoSeconds) <= SOUNDTRACK_TOLERANCE) return null;
  return `The soundtrack is ${minutes(audioSeconds)} but the video is ${minutes(videoSeconds)}; master it with Lead-in and Tail at 0`;
}

export function isAudioFile(file: NamedFile): boolean {
  return !isVideoFile(file) && (file.type.startsWith("audio/") || /\.(wav|mp3|flac|ogg|oga|opus|m4a|aac)$/i.test(file.name));
}

/** Exactly one video and one audio file, in either order: the video plus its mastered soundtrack. */
export function pairVideoAndSoundtrack<T extends NamedFile>(files: T[]): { video: T; soundtrack: T } | null {
  if (files.length !== 2) return null;
  const video = files.find(isVideoFile);
  const soundtrack = files.find(isAudioFile);
  return video && soundtrack ? { video, soundtrack } : null;
}
