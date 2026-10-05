import { describe, it, expect, vi } from "vitest";
import { ElevenLabsClient } from "../src/client.js";

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

// "Hi du" spoken over 1.2 s: characters H, i, space, d, u
const alignmentBody = {
  audio_base64: Buffer.from("fake-mp3").toString("base64"),
  alignment: {
    characters: ["H", "i", " ", "d", "u"],
    character_start_times_seconds: [0.0, 0.2, 0.4, 0.5, 0.9],
    character_end_times_seconds: [0.2, 0.4, 0.5, 0.9, 1.2],
  },
};

const sent = (fetchMock: ReturnType<typeof vi.fn>, call = 0) => {
  const [url, init] = fetchMock.mock.calls[call] as unknown as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) };
};

describe("ElevenLabsClient", () => {
  it("synthesizes and derives word timings from character alignment", async () => {
    const fetchMock = vi.fn(async () => okResponse(alignmentBody));
    const res = await new ElevenLabsClient("key", fetchMock as unknown as typeof fetch).synthesize({ voiceId: "v1", text: "Hi du", modelId: "eleven_v3" });
    expect(res.audio.toString()).toBe("fake-mp3");
    expect(res.durationS).toBeCloseTo(1.2);
    expect(res.wordTimings).toEqual([
      { word: "Hi", start: 0.0, end: 0.4 },
      { word: "du", start: 0.5, end: 1.2 },
    ]);
    const { url, init, body } = sent(fetchMock);
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/v1/with-timestamps?output_format=mp3_44100_128");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("key");
    expect(body).toEqual({ text: "Hi du", model_id: "eleven_v3" });
  });

  it("sends v3 direction as tags and per-request stability without changing the caller's text", async () => {
    const fetchMock = vi.fn(async () => okResponse(alignmentBody));
    const req = { voiceId: "v1", text: "Hi du", modelId: "eleven_v3", direction: { tags: ["curious", "sighs"], stability: "natural" as const } };
    await new ElevenLabsClient("key", fetchMock as unknown as typeof fetch).synthesize(req);
    expect(sent(fetchMock).body).toEqual({ text: "[curious] [sighs] Hi du", model_id: "eleven_v3", voice_settings: { stability: 0.5 } });
    expect(req.text).toBe("Hi du");
  });

  it("sends v4 direction tags with v4's gentler stability steps", async () => {
    const fetchMock = vi.fn(async () => okResponse(alignmentBody));
    await new ElevenLabsClient("key", fetchMock as unknown as typeof fetch).synthesize({ voiceId: "v1", text: "Hi du", modelId: "eleven_v4", direction: { tags: ["whispering"], stability: "creative" } });
    expect(sent(fetchMock).body).toEqual({ text: "[whispering] Hi du", model_id: "eleven_v4", voice_settings: { stability: 0.35 } });
  });

  it("passes the language code through", async () => {
    const fetchMock = vi.fn(async () => okResponse(alignmentBody));
    await new ElevenLabsClient("key", fetchMock as unknown as typeof fetch).synthesize({ voiceId: "v1", text: "Hallo", modelId: "eleven_v4", languageCode: "de" });
    expect(sent(fetchMock).body.language_code).toBe("de");
  });

  it("allows v4 input up to 10,000 characters", async () => {
    const fetchMock = vi.fn(async () => okResponse(alignmentBody));
    const client = new ElevenLabsClient("key", fetchMock as unknown as typeof fetch);
    await client.synthesize({ voiceId: "v", text: "x".repeat(6000), modelId: "eleven_v4", direction: { tags: ["calm"] } });
    await expect(client.synthesize({ voiceId: "v", text: "x".repeat(10000), modelId: "eleven_v4", direction: { tags: ["calm"] } })).rejects.toThrow(/10,000/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported tags and overlong v3 input before a paid request", async () => {
    const fetchMock = vi.fn();
    const client = new ElevenLabsClient("key", fetchMock);
    await expect(client.synthesize({ voiceId: "v", text: "Hello", modelId: "eleven_multilingual_v2", direction: { tags: ["curious"] } })).rejects.toThrow(/require the eleven_v3/);
    await expect(client.synthesize({ voiceId: "v", text: "x".repeat(5000), modelId: "eleven_v3", direction: { tags: ["curious"] } })).rejects.toThrow(/5,000/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries on 429 then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(okResponse(alignmentBody));
    const res = await new ElevenLabsClient("key", fetchMock as unknown as typeof fetch, { retryDelayMs: 1 }).synthesize({ voiceId: "v1", text: "Hi du", modelId: "eleven_v3" });
    expect(res.durationS).toBeCloseTo(1.2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after three server errors with the last error in the message", async () => {
    const fetchMock = vi.fn(async () => new Response("upstream down", { status: 503 }));
    await expect(new ElevenLabsClient("key", fetchMock as unknown as typeof fetch, { retryDelayMs: 1 }).synthesize({ voiceId: "v1", text: "x", modelId: "eleven_v3" }))
      .rejects.toThrow(/ElevenLabs 503: upstream down \(after 3 attempts\)/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws a labelled error on a 401 without retrying", async () => {
    const fetchMock = vi.fn(async () => new Response("bad key", { status: 401 }));
    await expect(new ElevenLabsClient("key", fetchMock as unknown as typeof fetch, { retryDelayMs: 1 }).synthesize({ voiceId: "v1", text: "x", modelId: "eleven_v3" }))
      .rejects.toThrow(/ElevenLabs 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
