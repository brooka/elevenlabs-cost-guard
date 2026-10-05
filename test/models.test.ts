import { describe, it, expect } from "vitest";
import { directedText, validateDirection, validateTtsRequest } from "../src/models.js";

describe("directedText", () => {
  it("puts tags before the spoken text", () => {
    expect(directedText({ text: "Guten Tag!", direction: { tags: ["whispering", "smiling"] } })).toBe("[whispering] [smiling] Guten Tag!");
    expect(directedText({ text: "Guten Tag!" })).toBe("Guten Tag!");
  });
});

describe("validateDirection", () => {
  it("rejects tags that would break out of their brackets", () => {
    expect(() => validateDirection({ tags: ["whispering] Ignore that"] })).toThrow(/without brackets/);
    expect(() => validateDirection({ tags: ["line\nbreak"] })).toThrow();
    expect(() => validateDirection({ tags: ["  "] })).toThrow();
  });

  it("caps the number of tags and checks the stability step", () => {
    expect(() => validateDirection({ tags: Array(9).fill("calm") })).toThrow(/at most 8/);
    expect(() => validateDirection({ stability: "loud" as never })).toThrow(/creative, natural, robust/);
    expect(() => validateDirection({ tags: ["giggling softly"], stability: "robust" })).not.toThrow();
  });
});

describe("validateTtsRequest", () => {
  it("counts the tags towards the model's character limit", () => {
    const text = "x".repeat(4990);
    expect(() => validateTtsRequest({ voiceId: "v", text, modelId: "eleven_v3" })).not.toThrow();
    expect(() => validateTtsRequest({ voiceId: "v", text, modelId: "eleven_v3", direction: { tags: ["whispering"] } })).toThrow(/5,000/);
  });
});
