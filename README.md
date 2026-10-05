# elevenlabs-cost-guard

A small TypeScript client for the ElevenLabs text-to-speech API that never pays twice for the same line, and returns word timings and captions with every recording.

## TL;DR

```ts
import { ElevenLabsClient, getLine } from "./src/index.js";

const client = new ElevenLabsClient(process.env.ELEVENLABS_API_KEY!);

const { file, paid, wordTimings } = await getLine(client, {
  voiceId: "<voice_id>",
  text: "Guten Tag! Wie geht es dir?",
  modelId: "eleven_v4",
  languageCode: "de",
});
```

- **First time a line is asked for:** ElevenLabs is called (paid) and the audio is saved as `audio/<key>.mp3`. `paid` is `true`.
- **Every time after that:** the saved file is returned. No API call, no charge. `paid` is `false`.
- **Change anything about the line** (text, voice, model, language or direction): it counts as a new line and is recorded once.
- **Captions:** `toSrt(captionsFromWords(wordTimings))`.

Call `getLine` for every line of a script on every build. Only new or edited lines cost anything.

```bash
npm install
npm test        # 34 tests, mocked fetch, no API key needed

ELEVENLABS_API_KEY=... npm run speak -- <voice_id> "Guten Tag! Wie geht es dir?" --model eleven_v4 --lang de
# first run:  Recorded with ElevenLabs (paid) → audio/<key>.mp3
# second run: Reused audio/<key>.mp3 (no API call, no charge), and no API key needed
```

## Why it exists

The ElevenLabs API bills every request by the character, including a request identical to one made earlier. The website offers two free regenerations of identical content; the API does not ([ElevenLabs](https://elevenlabs.io/blog/two-free-regenerations)). Neither the API nor the official SDK keeps a record of what has already been generated, so a pipeline that rebuilds from a script after every edit pays for every line again.

ElevenLabs' integration guide recommends caching each result under a hash of every input that affects the audio ([ElevenLabs, Text to Speech API integration](https://elevenlabs.io/blog/text-to-speech-api-integration)). This client implements that, and covers two smaller jobs the API leaves to the caller:

| Gap | What the API and SDK provide | What this adds |
|---|---|---|
| Re-billing for unchanged audio | Every request is billed; past requests aren't tracked by their inputs | `getLine`: a hash of the line's inputs as its key; a saved recording is reused instead of re-requested |
| Words, not characters | `with-timestamps` returns a start and end time per **character** | Word timings (ignoring `[audio tags]`) and SRT captions |
| Errors found mid-batch | The API rejects bad input as each request arrives | Tags and per-model length limits are checked before anything is sent |

**In production:** across 103 rebuilds of a ten-script pipeline, this sent 665 lines instead of 6,408, and 90% fewer characters.

## Under the hood

### The three steps

Every line goes through the same steps:

```
for each line in the script:
    key = hash(model, voice, language, text, direction)

    if audio/<key>.mp3 is already saved:
        use the saved file              <- free: no API call, no charge
    else:
        call ElevenLabs                 <- the only step that costs money
        save the result as audio/<key>.mp3
```

That is exactly what `getLine` does (`src/line.ts`):

```ts
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
```

Called over a two-line script:

```ts
const script = [
  { voiceId: "<narrator_voice_id>", text: "Der Laden öffnet um neun." },
  { voiceId: "<character_voice_id>", text: "Guten Tag! Wie geht es dir?" },
];

for (const line of script) {
  const { paid, file } = await getLine(client, { ...line, modelId: "eleven_v4", languageCode: "de" });
  console.log(paid ? `recorded ${file}` : `reused   ${file}`);
}
```

| Build | Output |
|---|---|
| First run | `recorded` for both lines |
| Second run, nothing changed | `reused` for both lines; ElevenLabs is not called |
| One line's text edited | `recorded` for that line only, `reused` for the other |

### The key

```
key = sha256(model | voice | language | text | direction)
```

The key holds everything that changes the sound and nothing that doesn't, so the same inputs always produce the same key (`src/cache.ts`). For a 40-line script:

| Build | Lines sent | Lines reused |
|---|---|---|
| First recording | 40 | 0 |
| One line edited | 1 | 39 |
| One character recast | that character's lines | the rest |
| Nothing changed (picture-only edit) | 0 | 40 |
| Model changed for the whole script | 40 | 0 |

- **One request per line keeps edits cheap.** A whole script sent as one request would be re-billed in full after any change.
- **The same build serves a first recording and an edit.** For a new script every key is new; after an edit only the changed lines' keys are. There is no separate edit mode.
- **Set the model per script or batch, not globally.** The model is part of every key, so a global switch re-records everything already finished.
- **An empty direction hashes exactly like no direction,** so adding direction support didn't invalidate older recordings.
- **Reused recordings keep edits stable.** A re-recorded line rarely comes back identical (its timing and delivery vary), so reusing unchanged lines stops timings, cuts and captions from drifting between builds.

### Checks before a request

`ElevenLabsClient` checks every line before anything is sent (`src/models.ts`):

- Direction tags: no brackets or line breaks, at most 8 per line.
- Tags are only sent to models that read them (`eleven_v3`, `eleven_v4`).
- Length, with tags counted in: 5,000 characters on v3, 10,000 on v4.

A failing line throws before any request is made, so a batch stops at the first bad line rather than partway through.

### Retries

Retries are not a gap: the official SDK retries 408, 409, 429 and 5xx responses. This client uses plain `fetch`, so it implements the rule itself (`src/client.ts`): up to three attempts on 429 and 5xx only, with exponential backoff and full jitter. Any other error (400, 401, 422) fails at once with the status and the start of the response body.

### Word timings

`POST /v1/text-to-speech/{voice_id}/with-timestamps` returns the audio plus a start and end time for every **character**. Captions, read-along highlighting and cutting a single word out of a recording need **words**. `wordTimingsFromAlignment` builds them (`src/alignment.ts`):

| characters | G | u | t | e | n | ␣ | T | a | g |
|---|---|---|---|---|---|---|---|---|---|
| start (s) | 0.00 | 0.08 | 0.14 | 0.21 | 0.29 | 0.38 | 0.44 | 0.55 | 0.63 |
| end (s) | 0.08 | 0.14 | 0.21 | 0.29 | 0.38 | 0.44 | 0.55 | 0.63 | 0.70 |

becomes `{ word: "Guten", start: 0.00, end: 0.38 }`, `{ word: "Tag", start: 0.44, end: 0.70 }` (illustrative timings).

- A word starts at its first character's start time and ends at its last character's end time.
- Whitespace splits words; punctuation stays with its word.
- Anything inside `[audio tags]` is skipped, because tags are directions, not speech.
- Word edges are typically about ±0.1 s off: fine for captions. Cutting a word out of a recording needs the edges refined against the audio's loudness envelope.

### Captions

`captionsFromWords` splits timed words the way a subtitler would (`src/captions.ts`):

1. End a caption at a sentence end, once it has some length.
2. Otherwise, when it gets too long, break after its last comma, semicolon or colon.
3. Wrap each caption into two balanced lines of about 42 characters.
4. Keep every caption on screen for at least a second, and never let two overlap.

`toSrt` writes the result as an SRT file, the format video platforms accept for uploaded captions.

### Model notes

| | `eleven_v3` | `eleven_v4` |
|---|---|---|
| Max characters per request | 5,000 | 10,000 |
| Audio tags | Yes | Yes, including plain-English directions |
| Stability steps used here (creative / natural / robust) | 0 / 0.5 / 1 | 0.35 / 0.5 / 0.75 (very low stability is erratic) |
| `style` and `speed` | Applied | Ignored |

On v4 a vague tag can come out as a sound effect, so tags work best written as voice descriptions: "giggling softly", not "giggling".

### Layout

| File | What it does |
|---|---|
| `src/line.ts` | `getLine`: reuse the saved recording, or call ElevenLabs and save it |
| `src/cache.ts` | The content hash used as each recording's key |
| `src/client.ts` | The `with-timestamps` call, checks and retries |
| `src/models.ts` | Per-model limits, stability steps, checks before the call |
| `src/alignment.ts` | Character timings to word timings |
| `src/captions.ts` | Caption splitting, wrapping and SRT output |
| `examples/speak.ts` | One line through `getLine`; prints whether it was recorded or reused |

## Licence

MIT
