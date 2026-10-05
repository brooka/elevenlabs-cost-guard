# elevenlabs-cost-guard

A small TypeScript client for the ElevenLabs text-to-speech API that stops a pipeline paying again for audio it already has. It also turns ElevenLabs' character timings into word timings and captions.

## The problem it solves

The ElevenLabs API bills every request by the character, even when the text, voice and settings are exactly the same as a request you made yesterday. The website gives two free regenerations of identical content, but the API doesn't ([ElevenLabs](https://elevenlabs.io/blog/two-free-regenerations)). And neither the API nor the official SDK keeps a record of what you've already generated.

For one-off calls that doesn't matter. For a pipeline that builds audio from a script, it does: change one line, rebuild, and every line is sent and billed again. ElevenLabs' own integration guide recommends the fix, which is to cache each result under a hash of every input that affects the audio ([ElevenLabs, Text to Speech API integration](https://elevenlabs.io/blog/text-to-speech-api-integration)). This client implements that, plus two smaller jobs the API leaves to you:

| Gap | What the API and SDK give you | What this adds |
|---|---|---|
| Paying again for audio you already have | Every request is billed; nothing remembers past requests by their inputs | A hash of model, voice, language, text and direction as the cache key. Unchanged lines are never sent |
| Words, not characters | `with-timestamps` returns a start and end time per **character** | Word timings (ignoring `[audio tags]`) and SRT captions |
| Mistakes found halfway through a batch | The API rejects bad input when each request arrives | Tags and per-model length limits are checked before anything is sent, so a bad line fails first, not at line 60 of 90 |

Retries are not a gap: the official SDK already retries 408, 409, 429 and 5xx responses. This client calls the API with plain `fetch`, so it implements the rule itself: 429 and 5xx only, exponential backoff with jitter, as the integration guide recommends.

## Has it saved money?

Yes, measurably, although the money isn't the biggest win.

This code comes from a production audio pipeline. Reconstructing that pipeline's git history from 1 September to 5 October 2026, across ten finished productions:

| | With the cache | Without it |
|---|---|---|
| Rebuilds of the audio (committed ones only) | 103 | 103 |
| Lines sent to ElevenLabs | 675 | 9,729 |
| Characters billed | about 41,000 | about 601,000 |

That's about **560,000 characters (93%) not billed again**: roughly $45 at v3's API price of $0.08 per 1,000 characters, or the same amount of a subscription's monthly allowance. Treat it as a floor, because rebuilds that never got committed aren't counted.

The bigger win is stability. A re-recorded line rarely comes back identical, because its timing and delivery vary between generations. Without the cache, every rebuild would shift the cuts, timings and captions of work that was already finished.

## When you need it: an example

You finish a 90-line production, about 6,000 characters, and then fix a typo in one line.

- **Without a cache**, rebuilding sends all 90 lines again. You pay for about 6,000 characters, and every line comes back slightly different, so the finished edit drifts.
- **With it**, only the edited line has a new hash. One request goes out (about 60 characters) and everything else is reused as it is.

A real case from the pipeline above: one production was revised at least 18 times after its first recording. Those revisions sent 8,570 characters of changed lines. Re-sending the whole production each time would have been 112,353.

The same thing happens when you:

- **Switch new work to a new model.** The model is part of the hash, so set it per piece of work, not globally. A global switch re-records everything you've already finished.
- **Add direction tags to a few lines.** Only those lines are re-sent. An empty direction hashes exactly like no direction, so adding the feature didn't invalidate older audio.
- **Rebuild everything in CI on every commit.** Unchanged lines cost nothing.

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

const key = ttsSourceHash(req);        // check your store for this key first: same key, same audio
const { audio, wordTimings, durationS } = await new ElevenLabsClient(process.env.ELEVENLABS_API_KEY!).synthesize(req);
const srt = toSrt(captionsFromWords(wordTimings));
```

## What's checked before a request

- Direction tags: no brackets or line breaks, at most 8 per line.
- Tags are only sent to models that read them (`eleven_v3`, `eleven_v4`).
- Length, with the tags counted in: 5,000 characters on v3, 10,000 on v4.

A failing line throws before any request is made, so a batch stops at the first bad line instead of partway through.

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
| `src/cache.ts` | The content hash used as each recording's cache key |
| `src/client.ts` | The `with-timestamps` call, retries and result |
| `src/models.ts` | Per-model limits, stability steps, checks before the call |
| `src/alignment.ts` | Character timings to word timings |
| `src/captions.ts` | Caption splitting, wrapping and SRT output |
| `examples/speak.ts` | One line in; audio, word timings and SRT out, skipped if unchanged |

## Licence

MIT
