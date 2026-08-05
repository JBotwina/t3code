import {
  READ_ALOUD_INWORLD_MODEL_ID,
  READ_ALOUD_INWORLD_VOICE_ID,
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

type InworldWordAlignment = {
  /** Every token of the input in order: words, punctuation, and whitespace. */
  readonly words?: ReadonlyArray<string>;
  readonly wordStartTimeSeconds?: ReadonlyArray<number>;
  readonly wordEndTimeSeconds?: ReadonlyArray<number>;
};

type InworldSynthesizeResponse = {
  readonly audioContent?: string;
  readonly timestampInfo?: {
    readonly wordAlignment?: InworldWordAlignment;
  };
};

/**
 * Inworld emits one token per word, punctuation mark, and whitespace run;
 * ElevenLabs emits characters that we regroup on whitespace. Merging runs of
 * non-whitespace tokens here makes both providers produce the same word spans,
 * so the highlight logic downstream stays provider-agnostic.
 *
 * Offsets are recovered with indexOf rather than by accumulating token lengths:
 * if text normalization rewrites a token ("5" spoken as "five"), a running
 * cursor would silently skew every later word, while a failed lookup only
 * drops the one word we cannot place.
 */
function wordsFromAlignment(
  alignment: InworldWordAlignment | undefined,
  text: string,
): ReadonlyArray<ReadAloudWordTiming> {
  const tokens = alignment?.words ?? [];
  const starts = alignment?.wordStartTimeSeconds ?? [];
  const ends = alignment?.wordEndTimeSeconds ?? [];
  if (tokens.length === 0 || starts.length !== tokens.length) return [];

  const words: ReadAloudWordTiming[] = [];
  let searchFrom = 0;
  let run: { text: string; startSec: number; endSec: number } | null = null;

  const flush = () => {
    if (run === null) return;
    const pending = run;
    run = null;
    const charStart = text.indexOf(pending.text, searchFrom);
    if (charStart < 0) return;
    const charEnd = charStart + pending.text.length;
    searchFrom = charEnd;
    words.push({
      text: pending.text,
      startMs: Math.round(pending.startSec * 1000),
      endMs: Math.round(pending.endSec * 1000),
      charStart,
      charEnd,
    });
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token.length === 0) continue;
    if (/^\s+$/.test(token)) {
      flush();
      continue;
    }
    const startSec = starts[index] ?? 0;
    const endSec = ends[index] ?? startSec;
    if (run === null) {
      run = { text: token, startSec, endSec };
    } else {
      run.text += token;
      run.endSec = Math.max(run.endSec, endSec);
    }
  }
  flush();
  return words;
}

export const synthesizeInworld = (
  text: string,
): Effect.Effect<
  ReadAloudSynthesizeResult,
  ReadAloudApiKeyMissingError | ReadAloudProviderError,
  ServerSecretStore.ServerSecretStore | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const apiKey = yield* ReadAloudApiKeys.resolveApiKey("inworld");
    const httpClient = yield* HttpClient.HttpClient;

    const response = yield* HttpClientRequest.post("https://api.inworld.ai/tts/v1/voice").pipe(
      // The portal hands out a key that is already base64(apiKey:), so it is
      // passed through as the Basic credential rather than re-encoded.
      HttpClientRequest.setHeader("authorization", `Basic ${apiKey}`),
      HttpClientRequest.setHeader("accept", "application/json"),
      HttpClientRequest.bodyJson({
        text,
        voiceId: READ_ALOUD_INWORLD_VOICE_ID,
        modelId: READ_ALOUD_INWORLD_MODEL_ID,
        timestampType: "WORD",
        audioConfig: {
          audioEncoding: "MP3",
          sampleRateHertz: 24_000,
        },
      }),
      Effect.mapError(
        (cause) =>
          new ReadAloudProviderError({
            detail: cause instanceof Error ? cause.message : "Inworld request encoding failed",
          }),
      ),
      Effect.flatMap(httpClient.execute),
      Effect.mapError(
        (cause) =>
          new ReadAloudProviderError({
            detail: cause instanceof Error ? cause.message : "Inworld request failed",
          }),
      ),
    );

    if (response.status < 200 || response.status >= 300) {
      const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      const detail = body.slice(0, 400) || `Inworld HTTP ${response.status}`;
      return yield* new ReadAloudProviderError({ status: response.status, detail });
    }

    const payload = (yield* response.json.pipe(
      Effect.mapError(
        (cause) =>
          new ReadAloudProviderError({
            detail: cause instanceof Error ? cause.message : "Invalid Inworld JSON",
          }),
      ),
    )) as InworldSynthesizeResponse;

    const audioBase64 = payload.audioContent;
    if (!audioBase64) {
      return yield* new ReadAloudProviderError({ detail: "Inworld response missing audio" });
    }

    yield* Effect.fromResult(Encoding.decodeBase64(audioBase64)).pipe(
      Effect.mapError(
        () => new ReadAloudProviderError({ detail: "Inworld audio was not valid base64" }),
      ),
    );

    return {
      engine: "inworld" as const,
      audioBase64,
      mimeType: "audio/mpeg",
      words: wordsFromAlignment(payload.timestampInfo?.wordAlignment, text),
    };
  });
