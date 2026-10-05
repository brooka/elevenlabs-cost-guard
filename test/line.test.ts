import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLine } from "../src/line.js";
import type { TtsClient, TtsRequest } from "../src/types.js";

// A stand-in for ElevenLabs that counts how many times it was called.
function fakeClient() {
  const client = {
    calls: 0,
    async synthesize(req: TtsRequest) {
      client.calls++;
      return { audio: Buffer.from(`audio for ${req.text}`), durationS: 1, wordTimings: [{ word: req.text, start: 0, end: 1 }], alignment: { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] } };
    },
  };
  return client satisfies TtsClient;
}

const line = (text: string): TtsRequest => ({ voiceId: "v", text, modelId: "eleven_v4", languageCode: "de" });
const tempDir = () => mkdtempSync(join(tmpdir(), "cost-guard-"));

describe("getLine", () => {
  it("calls ElevenLabs for a line it has never seen, and saves the audio", async () => {
    const dir = tempDir();
    const client = fakeClient();
    const result = await getLine(client, line("Guten Tag!"), dir);
    expect(result.paid).toBe(true);
    expect(client.calls).toBe(1);
    expect(result.file).toBe(join(dir, `${result.key}.mp3`));
    rmSync(dir, { recursive: true });
  });

  it("reuses the saved file for the same line, without calling ElevenLabs again", async () => {
    const dir = tempDir();
    const client = fakeClient();
    const first = await getLine(client, line("Guten Tag!"), dir);
    const second = await getLine(client, line("Guten Tag!"), dir);
    expect(second.paid).toBe(false);
    expect(client.calls).toBe(1);
    expect(second.audio.equals(first.audio)).toBe(true);
    expect(second.wordTimings).toEqual(first.wordTimings);
    rmSync(dir, { recursive: true });
  });

  it("calls ElevenLabs again only for the line that changed", async () => {
    const dir = tempDir();
    const client = fakeClient();
    const script = ["Guten Tag!", "Wie geht es dir?", "Bis morgen!"];
    for (const text of script) await getLine(client, line(text), dir);
    expect(client.calls).toBe(3);

    const edited = ["Guten Tag!", "Wie geht es Ihnen?", "Bis morgen!"];
    const results = [];
    for (const text of edited) results.push(await getLine(client, line(text), dir));
    expect(results.map((r) => r.paid)).toEqual([false, true, false]);
    expect(client.calls).toBe(4);
    rmSync(dir, { recursive: true });
  });

  it("re-records a line whose saved files are incomplete", async () => {
    const dir = tempDir();
    const client = fakeClient();
    const first = await getLine(client, line("Guten Tag!"), dir);
    rmSync(join(dir, `${first.key}.words.json`));
    const again = await getLine(client, line("Guten Tag!"), dir);
    expect(again.paid).toBe(true);
    expect(client.calls).toBe(2);
    rmSync(dir, { recursive: true });
  });
});
