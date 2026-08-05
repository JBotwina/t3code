import {
  READ_ALOUD_ELEVENLABS_MODEL_ID,
  READ_ALOUD_ELEVENLABS_VOICE_ID,
  ReadAloudApiKeyMissingError,
  ReadAloudProviderError,
  type ReadAloudSynthesizeResult,
  type ReadAloudWordTiming,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ReadAloudApiKeys from "./apiKeys.ts";

type ElevenLabsAlignment = {
  readonly characters?: ReadonlyArray<string>;
  readonly character_start_times_seconds?: ReadonlyArray<number>;
  readonly character_end_times_seconds?: ReadonlyArray<number>;
};

type ElevenLabsTimestampResponse = {
  readonly audio_base64?: string;
  readonly alignment?: ElevenLabsAlignment;
  readonly normalized_alignment?: ElevenLabsAlignment;
};

function wordsFromAlignment(
  alignment: ElevenLabsAlignment | undefined,
): ReadonlyArray<ReadAloudWordTiming> {
  const characters = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  if (characters.length === 0 || starts.length !== characters.length) return [];

  const words: ReadAloudWordTiming[] = [];
  let charStart = 0;
  while (charStart < characters.length) {
    while (charStart < characters.length && /\s/.test(characters[charStart] ?? "")) {
      charStart += 1;
    }
    if (charStart >= characters.length) break;
    let charEnd = charStart;
    while (charEnd < characters.length && !/\s/.test(characters[charEnd] ?? "")) {
      charEnd += 1;
    }
    const text = characters.slice(charStart, charEnd).join("");
    const startSec = starts[charStart] ?? 0;
    const endSec = ends[charEnd - 1] ?? starts[charEnd - 1] ?? startSec;
    words.push({
      text,
      startMs: Math.round(startSec * 1000),
      endMs: Math.round(endSec * 1000),
      charStart,
      charEnd,
    });
    charStart = charEnd;
  }
  return words;
}

export const synthesizeElevenLabs = (
  text: string,
): Effect.Effect<
  ReadAloudSynthesizeResult,
  ReadAloudApiKeyMissingError | ReadAloudProviderError,
  ServerSecretStore.ServerSecretStore | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const apiKey = yield* ReadAloudApiKeys.resolveApiKey("elevenlabs");
    const httpClient = yield* HttpClient.HttpClient;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${READ_ALOUD_ELEVENLABS_VOICE_ID}/with-timestamps`;

    const response = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeader("xi-api-key", apiKey),
      HttpClientRequest.setHeader("accept", "application/json"),
      HttpClientRequest.bodyJson({
        text,
        model_id: READ_ALOUD_ELEVENLABS_MODEL_ID,
      }),
      Effect.mapError(
        (cause) =>
          new ReadAloudProviderError({
            detail: cause instanceof Error ? cause.message : "ElevenLabs request encoding failed",
          }),
      ),
      Effect.flatMap(httpClient.execute),
      Effect.mapError(
        (cause) =>
          new ReadAloudProviderError({
            detail: cause instanceof Error ? cause.message : "ElevenLabs request failed",
          }),
      ),
    );

    if (response.status < 200 || response.status >= 300) {
      const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      const detail = body.slice(0, 400) || `ElevenLabs HTTP ${response.status}`;
      return yield* new ReadAloudProviderError({ status: response.status, detail });
    }

    const payload = (yield* response.json.pipe(
      Effect.mapError(
        (cause) =>
          new ReadAloudProviderError({
            detail: cause instanceof Error ? cause.message : "Invalid ElevenLabs JSON",
          }),
      ),
    )) as ElevenLabsTimestampResponse;

    const audioBase64 = payload.audio_base64;
    if (!audioBase64) {
      return yield* new ReadAloudProviderError({ detail: "ElevenLabs response missing audio" });
    }

    yield* Effect.fromResult(Encoding.decodeBase64(audioBase64)).pipe(
      Effect.mapError(
        () => new ReadAloudProviderError({ detail: "ElevenLabs audio was not valid base64" }),
      ),
    );

    const words = wordsFromAlignment(payload.normalized_alignment ?? payload.alignment);
    return {
      engine: "elevenlabs-flash" as const,
      audioBase64,
      mimeType: "audio/mpeg",
      words,
    };
  });
