import { describe, expect, it } from "vitest";
import { HANDOFF_READY, parseHandoff, senderOriginFor } from "./handoff.ts";

describe("senderOriginFor", () => {
  it.each([
    ["https://shader.dannybrown.dev", "https://master.dannybrown.dev"],
    ["http://127.0.0.1:5173", "http://127.0.0.1:5174"],
    ["http://localhost:5173", "http://localhost:5174"],
    ["http://shader.dannybrown.dev", null],
    ["https://evil.dev", null],
    ["https://shader.dannybrown.dev.evil.dev", null],
    ["http://127.0.0.1:4173", null],
    ["null", null],
  ])("%s → %s", (origin, expected) => {
    expect(senderOriginFor(origin)).toBe(expected);
  });
});

const video = new File([new Uint8Array(4)], "take.mp4", { type: "video/mp4" });
const audio = new Blob([new Uint8Array(4)], { type: "audio/wav" });
const good = { type: "music-shader:handoff", v: 1, name: "take.mp4", video, audio };

describe("parseHandoff", () => {
  it("accepts a v1 handoff and names the files", () => {
    const h = parseHandoff(good);
    expect(h?.video.name).toBe("take.mp4");
    expect(h?.video.type).toBe("video/mp4");
    expect(h?.soundtrack.name).toBe("take.master.wav");
    expect(h?.soundtrack.type).toBe("audio/wav");
  });

  it("names a bare video Blob after the payload name", () => {
    expect(parseHandoff({ ...good, video: new Blob([new Uint8Array(4)]) })?.video.name).toBe("take.mp4");
  });

  it.each([
    ["null", null],
    ["string", "music-shader:handoff"],
    ["ready message", HANDOFF_READY],
    ["wrong type", { ...good, type: "other" }],
    ["v2", { ...good, v: 2 }],
    ["v as string", { ...good, v: "1" }],
    ["missing name", { ...good, name: undefined }],
    ["empty name", { ...good, name: "" }],
    ["video not a blob", { ...good, video: "take.mp4" }],
    ["audio not a blob", { ...good, audio: new ArrayBuffer(4) }],
    ["empty audio", { ...good, audio: new Blob([]) }],
    ["empty video", { ...good, video: new Blob([]) }],
  ])("rejects %s", (_label, data) => {
    expect(parseHandoff(data)).toBeNull();
  });
});
