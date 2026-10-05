import type { WordTiming } from "./types.js";

export type Cue = { start: number; end: number; text: string };

export type CaptionOptions = {
  maxChars?: number;   // per caption (two lines)
  lineChars?: number;  // per line
  minDuration?: number;
  gap?: number;        // seconds kept between one caption and the next
};

const DEFAULTS: Required<CaptionOptions> = { maxChars: 84, lineChars: 42, minDuration: 1.0, gap: 0.05 };

// Two balanced lines, or one if it fits.
export function wrap(text: string, lineChars = DEFAULTS.lineChars): string {
  if (text.length <= lineChars) return text;
  const words = text.split(" ");
  let best: [number, string, string] | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const score = Math.max(a.length, b.length);
    if (!best || score < best[0]) best = [score, a, b];
  }
  return best ? `${best[1]}\n${best[2]}` : text;
}

const join = (ws: WordTiming[]) => ws.map((w) => w.word).join(" ");

// Split timed words into captions: prefer sentence ends, then clause breaks, then any word.
export function chunkWords(words: WordTiming[], maxChars = DEFAULTS.maxChars): WordTiming[][] {
  const out: WordTiming[][] = [];
  let cur: WordTiming[] = [];
  const flush = () => { if (cur.length) { out.push(cur); cur = []; } };
  for (const w of words) {
    cur.push(w);
    const text = join(cur);
    if (/[.!?…]["“”»]?$/.test(w.word) && text.length >= 20) {
      flush();
    } else if (text.length > maxChars) {
      // Break after the last clause mark inside the chunk, else before this word.
      let k = -1;
      cur.slice(0, -1).forEach((x, i) => { if (/[,;:]$/.test(x.word)) k = i; });
      const rest = k >= 0 && join(cur.slice(0, k + 1)).length >= 25 ? cur.slice(k + 1) : [cur[cur.length - 1]];
      const keep = cur.slice(0, cur.length - rest.length);
      cur = keep; flush(); cur = rest;
    }
  }
  flush();
  return out;
}

// Words to caption cues on the video's clock (offset = where this audio starts in the video),
// with a readable minimum length and no overlaps.
export function captionsFromWords(words: WordTiming[], offset = 0, options: CaptionOptions = {}): Cue[] {
  const o = { ...DEFAULTS, ...options };
  const cues = chunkWords(words, o.maxChars).map((c) => ({
    start: offset + c[0].start,
    end: offset + c[c.length - 1].end,
    text: wrap(join(c), o.lineChars),
  }));
  return cues.map((cue, i) => {
    const next = cues[i + 1]?.start;
    let end = Math.max(cue.end, cue.start + o.minDuration);
    if (next !== undefined) end = Math.min(end, next - o.gap);
    return { ...cue, end: Math.max(end, cue.start + 0.3) };
  });
}

export function srtTimestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTimestamp(c.start)} --> ${srtTimestamp(c.end)}\n${c.text}\n`).join("\n");
}
