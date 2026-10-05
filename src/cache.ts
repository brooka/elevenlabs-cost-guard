import { createHash } from "node:crypto";
import type { AudioDirection, TtsRequest } from "./types.js";

// The idempotency key for a recording: if none of model, voice, language, text or direction changed,
// the audio on disk is still right and the line is never re-recorded (or re-billed).
export function ttsSourceHash(req: TtsRequest): string {
  const direction = directionKey(req.direction);
  return createHash("sha256")
    .update(`${req.modelId}|${req.voiceId}|${req.languageCode ?? ""}|${req.text}${direction ? `|direction:${direction}` : ""}`)
    .digest("hex");
}

// An empty direction hashes like no direction, so adding the feature didn't invalidate existing audio.
export function directionKey(direction?: AudioDirection): string {
  if (!direction?.tags?.length && !direction?.stability) return "";
  return JSON.stringify({ tags: direction.tags ?? [], stability: direction.stability ?? null });
}
