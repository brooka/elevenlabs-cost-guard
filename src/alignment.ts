import type { Alignment, WordTiming } from "./types.js";

// ElevenLabs times every character; captions, read-alongs and word cuts need words.
// Walk the characters, start a word at its first character, end it at its last, split on whitespace,
// and skip anything inside [audio tags] because tags are directions, not speech.
export function wordTimingsFromAlignment(a: Alignment): WordTiming[] {
  const words: WordTiming[] = [];
  let word = "";
  let start = 0;
  let end = 0;
  let inTag = false;
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i];
    if (ch === "[") { if (word) words.push({ word, start, end }); word = ""; inTag = true; continue; }
    if (inTag) { if (ch === "]") inTag = false; continue; }
    if (/\s/.test(ch)) {
      if (word) words.push({ word, start, end });
      word = "";
    } else {
      if (!word) start = a.character_start_times_seconds[i];
      word += ch;
      end = a.character_end_times_seconds[i];
    }
  }
  if (word) words.push({ word, start, end });
  return words;
}

export function durationFromAlignment(a: Alignment): number {
  const ends = a.character_end_times_seconds;
  return ends.length ? ends[ends.length - 1] : 0;
}
