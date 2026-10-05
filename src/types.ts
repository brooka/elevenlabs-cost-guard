export type WordTiming = { word: string; start: number; end: number };

export type Stability = "creative" | "natural" | "robust";

// How a line should be performed: inline audio tags such as "whispering", and a stability step.
export type AudioDirection = { tags?: string[]; stability?: Stability };

export type TtsRequest = {
  voiceId: string;
  text: string;
  modelId: string;
  languageCode?: string;
  direction?: AudioDirection;
};

// The `alignment` object returned by POST /v1/text-to-speech/{voice_id}/with-timestamps.
export type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export type TtsResult = {
  audio: Buffer;
  durationS: number;
  wordTimings: WordTiming[];
  alignment: Alignment;
};

export interface TtsClient {
  synthesize(req: TtsRequest): Promise<TtsResult>;
}
