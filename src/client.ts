import { durationFromAlignment, wordTimingsFromAlignment } from "./alignment.js";
import { directedText, stabilityFor, validateTtsRequest } from "./models.js";
import type { Alignment, TtsClient, TtsRequest, TtsResult } from "./types.js";

const API = "https://api.elevenlabs.io/v1";

// Rate limits and server errors are worth another try; a bad key or a bad request never is.
const RETRYABLE = (status: number) => status === 429 || status >= 500;

export class ElevenLabsClient implements TtsClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly opts: { retryDelayMs?: number; attempts?: number; outputFormat?: string } = {}
  ) {}

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    validateTtsRequest(req);
    const url = `${API}/text-to-speech/${encodeURIComponent(req.voiceId)}/with-timestamps?output_format=${this.opts.outputFormat ?? "mp3_44100_128"}`;
    const body: Record<string, unknown> = { text: directedText(req), model_id: req.modelId };
    if (req.direction?.stability) body.voice_settings = { stability: stabilityFor(req.modelId, req.direction.stability) };
    if (req.languageCode) body.language_code = req.languageCode;

    const attempts = this.opts.attempts ?? 3;
    const delay = this.opts.retryDelayMs ?? 1000;
    let lastError = "";
    for (let attempt = 0; attempt < attempts; attempt++) {
      // Exponential backoff with full jitter, so many clients hitting a rate limit don't all retry at once.
      if (attempt > 0) await new Promise((r) => setTimeout(r, Math.random() * delay * 2 ** (attempt - 1)));
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = (await res.json()) as { audio_base64: string; alignment: Alignment };
        return {
          audio: Buffer.from(data.audio_base64, "base64"),
          durationS: durationFromAlignment(data.alignment),
          wordTimings: wordTimingsFromAlignment(data.alignment),
          alignment: data.alignment,
        };
      }
      lastError = `ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`;
      if (!RETRYABLE(res.status)) throw new Error(lastError);
    }
    throw new Error(`${lastError} (after ${attempts} attempts)`);
  }
}
