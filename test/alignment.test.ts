import { describe, it, expect } from "vitest";
import { durationFromAlignment, wordTimingsFromAlignment } from "../src/alignment.js";

// Evenly spaced characters, 0.1 s each.
const evenly = (text: string) => {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i / 10),
    character_end_times_seconds: characters.map((_, i) => (i + 1) / 10),
  };
};

describe("wordTimingsFromAlignment", () => {
  it("groups characters into words at whitespace", () => {
    expect(wordTimingsFromAlignment(evenly("Hi du"))).toEqual([
      { word: "Hi", start: 0, end: 0.2 },
      { word: "du", start: 0.3, end: 0.5 },
    ]);
  });

  it("excludes direction tags while keeping the spoken timestamps", () => {
    expect(wordTimingsFromAlignment(evenly("[sighs] Hi"))).toEqual([{ word: "Hi", start: 0.8, end: 1 }]);
  });

  it("ends a word that runs straight into a tag", () => {
    expect(wordTimingsFromAlignment(evenly("Oh[laughs] no")).map((w) => w.word)).toEqual(["Oh", "no"]);
  });

  it("keeps punctuation and non-ASCII letters with their word", () => {
    expect(wordTimingsFromAlignment(evenly("Grüß dich!")).map((w) => w.word)).toEqual(["Grüß", "dich!"]);
  });

  it("handles repeated whitespace and an empty alignment", () => {
    expect(wordTimingsFromAlignment(evenly("a   b")).map((w) => w.word)).toEqual(["a", "b"]);
    expect(wordTimingsFromAlignment({ characters: [], character_start_times_seconds: [], character_end_times_seconds: [] })).toEqual([]);
  });
});

describe("durationFromAlignment", () => {
  it("is the last character's end time", () => {
    expect(durationFromAlignment(evenly("Hallo"))).toBeCloseTo(0.5);
    expect(durationFromAlignment({ characters: [], character_start_times_seconds: [], character_end_times_seconds: [] })).toBe(0);
  });
});
