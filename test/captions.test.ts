import { describe, it, expect } from "vitest";
import { captionsFromWords, chunkWords, srtTimestamp, toSrt, wrap } from "../src/captions.js";
import type { WordTiming } from "../src/types.js";

// One word every 0.4 s.
const timed = (text: string): WordTiming[] => text.split(" ").map((word, i) => ({ word, start: i * 0.4, end: i * 0.4 + 0.3 }));

describe("wrap", () => {
  it("leaves short text on one line and balances long text over two", () => {
    expect(wrap("Guten Tag! Wie geht es dir?")).toBe("Guten Tag! Wie geht es dir?");
    const two = wrap("The delivery van kept going until every parcel in the town had been dropped off");
    const [a, b] = two.split("\n");
    expect(Math.abs(a.length - b.length)).toBeLessThan(10);
  });
});

describe("chunkWords", () => {
  it("ends a caption at a sentence end once it has some length", () => {
    const chunks = chunkWords(timed("The shop opens at nine today. It closes at six this evening."));
    expect(chunks.map((c) => c.map((w) => w.word).join(" "))).toEqual([
      "The shop opens at nine today.",
      "It closes at six this evening.",
    ]);
  });

  it("does not split off a very short sentence like Oh!", () => {
    expect(chunkWords(timed("Oh! The shop is open again.")).length).toBe(1);
  });

  it("breaks a long sentence after its last clause mark", () => {
    const text = "The train rolled on and on and on, until the fields became hills and then the hills became mountains outside the window";
    const chunks = chunkWords(timed(text));
    expect(chunks.length).toBe(2);
    expect(chunks[0][chunks[0].length - 1].word).toBe("on,");
    for (const c of chunks) expect(c.map((w) => w.word).join(" ").length).toBeLessThanOrEqual(84);
  });
});

describe("captionsFromWords", () => {
  it("shifts cues onto the video clock and never lets them overlap", () => {
    const cues = captionsFromWords(timed("Hallo Anna. Wie geht es dir heute?"), 10);
    expect(cues[0].start).toBeCloseTo(10);
    for (let i = 1; i < cues.length; i++) expect(cues[i - 1].end).toBeLessThan(cues[i].start);
  });

  it("holds a short caption on screen for at least the minimum duration", () => {
    const [cue] = captionsFromWords([{ word: "Ja!", start: 2, end: 2.2 }]);
    expect(cue.end - cue.start).toBeCloseTo(1);
  });
});

describe("SRT output", () => {
  it("formats timestamps and numbers the cues", () => {
    expect(srtTimestamp(3725.5)).toBe("01:02:05,500");
    expect(toSrt([{ start: 0, end: 1.25, text: "Hallo!" }, { start: 1.3, end: 2, text: "Wie geht's?" }]))
      .toBe("1\n00:00:00,000 --> 00:00:01,250\nHallo!\n\n2\n00:00:01,300 --> 00:00:02,000\nWie geht's?\n");
  });
});
