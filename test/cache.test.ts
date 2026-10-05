import { describe, it, expect } from "vitest";
import { ttsSourceHash } from "../src/cache.js";

describe("ttsSourceHash", () => {
  it("is stable and input-sensitive", () => {
    const a = ttsSourceHash({ voiceId: "v", text: "t", modelId: "m" });
    expect(a).toBe(ttsSourceHash({ voiceId: "v", text: "t", modelId: "m" }));
    expect(a).not.toBe(ttsSourceHash({ voiceId: "v", text: "t2", modelId: "m" }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the model, so switching a line to v4 re-records it", () => {
    expect(ttsSourceHash({ voiceId: "v", text: "t", modelId: "eleven_v3" })).not.toBe(ttsSourceHash({ voiceId: "v", text: "t", modelId: "eleven_v4" }));
  });

  it("changes with the language code", () => {
    expect(ttsSourceHash({ voiceId: "v", text: "t", modelId: "m", languageCode: "de" })).not.toBe(ttsSourceHash({ voiceId: "v", text: "t", modelId: "m", languageCode: "fr" }));
  });

  it("includes direction without invalidating undirected audio", () => {
    const req = { voiceId: "v", text: "Hallo", modelId: "eleven_v3" };
    expect(ttsSourceHash(req)).toBe(ttsSourceHash({ ...req, direction: { tags: [] } }));
    expect(ttsSourceHash(req)).not.toBe(ttsSourceHash({ ...req, direction: { tags: ["curious"] } }));
    expect(ttsSourceHash({ ...req, direction: { tags: [], stability: "natural" } })).not.toBe(ttsSourceHash({ ...req, direction: { tags: [], stability: "creative" } }));
  });
});
