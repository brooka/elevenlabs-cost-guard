// Speak one line and write its audio, word timings and an SRT caption file to ./out.
// A line that hasn't changed is skipped, because its content hash already has a file.
//
//   ELEVENLABS_API_KEY=... npx tsx examples/speak.ts <voice_id> "Guten Tag! Wie geht es dir?" --model eleven_v4 --lang de --tag whispering
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ElevenLabsClient, captionsFromWords, toSrt, ttsSourceHash, type TtsRequest } from "../src/index.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: "string", default: "eleven_v3" },
    lang: { type: "string" },
    tag: { type: "string", multiple: true },
    stability: { type: "string" },
  },
});

const [voiceId, text] = positionals;
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!voiceId || !text) throw new Error('Usage: speak.ts <voice_id> "text" [--model eleven_v4] [--lang de] [--tag whispering]');
if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY first.");

const req: TtsRequest = {
  voiceId,
  text,
  modelId: values.model!,
  languageCode: values.lang,
  direction: values.tag || values.stability ? { tags: values.tag ?? [], stability: values.stability as never } : undefined,
};

const base = join("out", ttsSourceHash(req).slice(0, 16));
const exists = await access(`${base}.mp3`).then(() => true, () => false);
if (exists) {
  console.log(`Unchanged line, already recorded: ${base}.mp3`);
  process.exit(0);
}

const res = await new ElevenLabsClient(apiKey).synthesize(req);
await mkdir("out", { recursive: true });
await writeFile(`${base}.mp3`, res.audio);
await writeFile(`${base}.words.json`, JSON.stringify(res.wordTimings, null, 2));
await writeFile(`${base}.srt`, toSrt(captionsFromWords(res.wordTimings)));

console.log(`${res.durationS.toFixed(2)} s, ${res.wordTimings.length} words → ${base}.{mp3,words.json,srt}`);
for (const w of res.wordTimings) console.log(`  ${w.start.toFixed(2)}–${w.end.toFixed(2)}  ${w.word}`);
