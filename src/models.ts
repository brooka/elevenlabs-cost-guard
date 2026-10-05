import type { AudioDirection, Stability, TtsRequest } from "./types.js";

// Models that read inline [direction] tags: their per-request character limit and what the three
// stability steps send. v4 turns erratic at very low stability, so its steps sit closer to the middle.
export const DIRECTED_MODELS: Record<string, { label: string; maxChars: number; stability: Record<Stability, number> }> = {
  eleven_v3: { label: "Eleven v3", maxChars: 5000, stability: { creative: 0, natural: 0.5, robust: 1 } },
  eleven_v4: { label: "Eleven v4", maxChars: 10000, stability: { creative: 0.35, natural: 0.5, robust: 0.75 } },
};

const STABILITY_STEPS: Stability[] = ["creative", "natural", "robust"];
const TAG = /^[^\[\]<>\r\n]+$/;

export function validateDirection(direction: AudioDirection) {
  const tags = direction.tags ?? [];
  if (tags.length > 8) throw new Error("Use at most 8 direction tags per line.");
  for (const tag of tags) {
    const t = tag.trim();
    if (!t || t.length > 60 || !TAG.test(t)) throw new Error(`Direction tag "${tag}" must be 1 to 60 characters without brackets, angle brackets or line breaks.`);
  }
  if (direction.stability && !STABILITY_STEPS.includes(direction.stability)) throw new Error(`Stability must be one of ${STABILITY_STEPS.join(", ")}.`);
}

// The text actually sent: tags first, so "[whispering] Guten Tag".
export function directedText(req: Pick<TtsRequest, "text" | "direction">): string {
  return [...(req.direction?.tags ?? []).map((tag) => `[${tag.trim()}]`), req.text].join(" ");
}

// Everything here runs before a paid request, so a bad line fails for free.
export function validateTtsRequest(req: TtsRequest) {
  if (req.direction) validateDirection(req.direction);
  const model = DIRECTED_MODELS[req.modelId];
  if (req.direction?.tags?.length && !model) throw new Error("Audio direction tags require the eleven_v3 or eleven_v4 model.");
  if (model && directedText(req).length > model.maxChars) throw new Error(`${model.label} accepts up to ${model.maxChars.toLocaleString("en-US")} characters including direction tags. Split this passage into shorter lines.`);
}

export function stabilityFor(modelId: string, step: Stability): number {
  return (DIRECTED_MODELS[modelId] ?? DIRECTED_MODELS.eleven_v3).stability[step];
}
