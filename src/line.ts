import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ttsSourceHash } from "./cache.js";
import type { TtsClient, TtsRequest, WordTiming } from "./types.js";

export type LineResult = {
  key: string;
  file: string;
  audio: Buffer;
  wordTimings: WordTiming[];
  paid: boolean; // true = ElevenLabs was called for this line; false = the saved file was reused
};

// The cost guard: if this exact line has been recorded before, reuse the saved file.
// Otherwise call ElevenLabs once, save the result, and reuse it from then on.
export async function getLine(client: TtsClient, req: TtsRequest, dir = "audio"): Promise<LineResult> {
  // 1. One key for everything that affects the sound: model, voice, language, text, direction.
  //    Same inputs always give the same key.
  const key = ttsSourceHash(req);
  const file = join(dir, `${key}.mp3`);
  const wordsFile = join(dir, `${key}.words.json`);

  // 2. Already have the audio for this key? Use it. No API call, no charge.
  if (existsSync(file) && existsSync(wordsFile)) {
    return {
      key,
      file,
      paid: false,
      audio: await readFile(file),
      wordTimings: JSON.parse(await readFile(wordsFile, "utf8")) as WordTiming[],
    };
  }

  // 3. Otherwise the line is new or has changed: call ElevenLabs (the only paid step) and save it.
  const { audio, wordTimings } = await client.synthesize(req);
  await mkdir(dir, { recursive: true });
  await writeFile(wordsFile, JSON.stringify(wordTimings));
  await writeFile(file, audio);
  return { key, file, paid: true, audio, wordTimings };
}
