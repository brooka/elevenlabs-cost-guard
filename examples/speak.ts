// Speak one line with the cost guard: if this exact line was recorded before, the saved file is reused
// and ElevenLabs is not called. Otherwise it's recorded once and saved. Also writes an SRT caption file.
//
//   ELEVENLABS_API_KEY=... npx tsx examples/speak.ts <voice_id> "Guten Tag! Wie geht es dir?" --model eleven_v4 --lang de --tag whispering
//
// Run the same command twice: the first run says "Recorded", the second says "Reused" and needs no API key.
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { ElevenLabsClient, captionsFromWords, getLine, toSrt, type TtsClient, type TtsRequest } from "../src/index.js";

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
if (!voiceId || !text) throw new Error('Usage: speak.ts <voice_id> "text" [--model eleven_v4] [--lang de] [--tag whispering]');

const req: TtsRequest = {
  voiceId,
  text,
  modelId: values.model!,
  languageCode: values.lang,
  direction: values.tag || values.stability ? { tags: values.tag ?? [], stability: values.stability as never } : undefined,
};

// The API key is only needed when a line actually has to be recorded.
const apiKey = process.env.ELEVENLABS_API_KEY;
const client: TtsClient = apiKey
  ? new ElevenLabsClient(apiKey)
  : { synthesize: async () => { throw new Error("This line hasn't been recorded yet. Set ELEVENLABS_API_KEY to record it."); } };

const { file, paid, wordTimings } = await getLine(client, req, "audio");
await writeFile(file.replace(/\.mp3$/, ".srt"), toSrt(captionsFromWords(wordTimings)));

console.log(paid ? `Recorded with ElevenLabs (paid) → ${file}` : `Reused ${file} (no API call, no charge)`);
for (const w of wordTimings) console.log(`  ${w.start.toFixed(2)}–${w.end.toFixed(2)}  ${w.word}`);
