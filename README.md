# elevenlabs-cost-guard

A careful client for the ElevenLabs text-to-speech API, built to stop you paying for audio you don't need:

- **It never pays twice for the same line.** Every recording is keyed by a hash of everything that changes the audio, so unchanged lines are skipped.
- **It never pays for a request that would fail.** Tags, model limits and inputs are checked before any call is made.
- **It only retries what's worth retrying.** Rate limits and server errors get backoff; bad requests fail at once, with the reason.

It also turns the `with-timestamps` response into word timings and SRT captions. About 250 lines of tested TypeScript, extracted from a production pipeline that has voiced around 1,400 clips on Eleven v3 and v4.

## Quick start

```bash
npm install
npm test        # 30 tests, mocked fetch, no API key needed

ELEVENLABS_API_KEY=... npm run speak -- <voice_id> "Guten Tag! Wie geht es dir?" --model eleven_v4 --lang de --tag whispering
```

`speak` writes `out/<hash>.mp3`, `out/<hash>.words.json` and `out/<hash>.srt`. Run it again with the same input and it makes no API call, because that hash already has a recording.

## Usage

```ts
import { ElevenLabsClient, ttsSourceHash, captionsFromWords, toSrt } from "./src/index.js";

const req = {
  voiceId: "<voice_id>",
  text: "Guten Tag! Wie geht es dir?",
  modelId: "eleven_v4",
  languageCode: "de",
  direction: { tags: ["whispering"], stability: "natural" as const },
};

const key = ttsSourceHash(req);        // look this up before calling: same key, same audio
const { audio, wordTimings, durationS } = await new ElevenLabsClient(process.env.ELEVENLABS_API_KEY!).synthesize(req);
const srt = toSrt(captionsFromWords(wordTimings));
```

## How it avoids wasted spend

**1. A content hash as the cache key.** `ttsSourceHash` is a SHA-256 of model, voice, language, text and direction: everything that changes the audio, and nothing that doesn't. If the hash already has a file, the line hasn't changed and isn't sent. An empty direction hashes exactly like no direction, so adding direction support didn't invalidate any existing recordings.

Because the model is part of the hash, switching every line to a new model would re-record everything you've already made. Set the model per batch of work (a chapter, an episode, a campaign) so finished work stays untouched while new work uses the new model.

**2. Validation before the paid call.** Direction tags are checked (no brackets or line breaks, at most 8), only sent to models that read them, and counted towards the model's limit: 5,000 characters on v3, 10,000 on v4. A bad line throws before any request is made.

**3. Retries only where they can help.** 429 and 5xx responses get up to three attempts with exponential backoff (1 s, then 2 s). A 400, 401 or 422 won't get better on a second try, so it fails at once with the status and the start of the response body.

## Word timings

`POST /v1/text-to-speech/{voice_id}/with-timestamps` returns the audio plus a start and end time for every **character**. Captions, read-along highlighting and cutting a single word out of a recording all need **words**. `wordTimingsFromAlignment` builds them:

| characters | G | u | t | e | n | ␣ | T | a | g |
|---|---|---|---|---|---|---|---|---|---|
| start (s) | 0.00 | 0.08 | 0.14 | 0.21 | 0.29 | 0.38 | 0.44 | 0.55 | 0.63 |
| end (s) | 0.08 | 0.14 | 0.21 | 0.29 | 0.38 | 0.44 | 0.55 | 0.63 | 0.70 |

becomes `{ word: "Guten", start: 0.00, end: 0.38 }`, `{ word: "Tag", start: 0.44, end: 0.70 }` (illustrative timings).

- A word starts at its first character's start time and ends at its last character's end time.
- Whitespace splits words; punctuation stays with its word.
- Anything inside `[audio tags]` is skipped, because tags are directions, not speech.
- In practice word edges are about ±0.1 s off. That's fine for captions. To cut a word out of a recording, refine the edges against the audio's loudness envelope.

## Captions

`captionsFromWords` splits timed words the way a subtitler would:

1. End a caption at a sentence end, once it has some length.
2. Otherwise, when it gets too long, break after its last comma, semicolon or colon.
3. Wrap each caption into two balanced lines of about 42 characters.
4. Keep every caption on screen for at least a second, and never let two overlap.

`toSrt` writes the result as an SRT file, which video platforms accept for uploaded captions.

## Model notes

| | `eleven_v3` | `eleven_v4` |
|---|---|---|
| Max characters per request | 5,000 | 10,000 |
| Audio tags | Yes | Yes, including plain-English directions |
| Stability steps used here (creative / natural / robust) | 0 / 0.5 / 1 | 0.35 / 0.5 / 0.75 (very low stability is erratic) |
| `style` and `speed` | Applied | Ignored |

On v4 a vague tag can come out as a sound effect, so write tags as voice descriptions: "giggling softly", not "giggling".

## Layout

| File | What it does |
|---|---|
| `src/client.ts` | The `with-timestamps` call, retries and result |
| `src/cache.ts` | The content hash used as the recording's cache key |
| `src/models.ts` | Per-model limits, stability steps, validation before the call |
| `src/alignment.ts` | Character alignment to word timings |
| `src/captions.ts` | Caption splitting, wrapping and SRT output |
| `examples/speak.ts` | One line in; audio, word timings and SRT out, skipped if unchanged |

## Licence

MIT
