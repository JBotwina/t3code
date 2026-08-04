import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

/**
 * Rachel: mid-register and evenly paced. Read-aloud speaks one sentence per
 * request, so a theatrical voice re-enters dramatically on every sentence;
 * neutral prosody is what makes consecutive sentences sound continuous.
 */
export const READ_ALOUD_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
/**
 * Turbo over Flash: Flash's latency optimization is what reads as robotic.
 * The extra ~150ms per sentence is hidden by the next-sentence prefetch in
 * ReadAloudSurface, so only the very first sentence pays it.
 */
export const READ_ALOUD_ELEVENLABS_MODEL_ID = "eleven_turbo_v2_5";
export const READ_ALOUD_API_KEY_SECRET_NAME = "tts-elevenlabs-api-key";

export const ReadAloudEngine = Schema.Literals(["elevenlabs-flash", "system"]);
export type ReadAloudEngine = typeof ReadAloudEngine.Type;

export const ReadAloudSettings = Schema.Struct({
  engine: ReadAloudEngine.pipe(
    Schema.withDecodingDefault(Effect.succeed("system" as const satisfies ReadAloudEngine)),
  ),
  /** Client-visible only; never persisted. Injected when settings are read. */
  apiKeyConfigured: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type ReadAloudSettings = typeof ReadAloudSettings.Type;

export const ReadAloudSettingsPatch = Schema.Struct({
  engine: Schema.optionalKey(ReadAloudEngine),
  /** Set a new key, or null/empty to clear. Never returned on read. */
  apiKey: Schema.optionalKey(Schema.NullOr(TrimmedString)),
});
export type ReadAloudSettingsPatch = typeof ReadAloudSettingsPatch.Type;

export const ReadAloudWordTiming = Schema.Struct({
  text: TrimmedNonEmptyString,
  startMs: Schema.Number,
  endMs: Schema.Number,
  charStart: Schema.Number,
  charEnd: Schema.Number,
});
export type ReadAloudWordTiming = typeof ReadAloudWordTiming.Type;

export const ReadAloudSynthesizeInput = Schema.Struct({
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(8_000)),
});
export type ReadAloudSynthesizeInput = typeof ReadAloudSynthesizeInput.Type;

export const ReadAloudSynthesizeResult = Schema.Struct({
  engine: ReadAloudEngine,
  /** Base64-encoded audio bytes (mp3 for ElevenLabs). Empty when engine is system. */
  audioBase64: Schema.String,
  mimeType: Schema.String,
  words: Schema.Array(ReadAloudWordTiming),
});
export type ReadAloudSynthesizeResult = typeof ReadAloudSynthesizeResult.Type;

export class ReadAloudApiKeyMissingError extends Schema.TaggedErrorClass<ReadAloudApiKeyMissingError>()(
  "ReadAloudApiKeyMissingError",
  {},
) {
  override get message(): string {
    return "ElevenLabs API key is not configured.";
  }
}

export class ReadAloudProviderError extends Schema.TaggedErrorClass<ReadAloudProviderError>()(
  "ReadAloudProviderError",
  {
    status: Schema.optionalKey(Schema.Number),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class ReadAloudUnsupportedEngineError extends Schema.TaggedErrorClass<ReadAloudUnsupportedEngineError>()(
  "ReadAloudUnsupportedEngineError",
  {
    engine: ReadAloudEngine,
  },
) {
  override get message(): string {
    return `Read-aloud engine "${this.engine}" is not synthesized on the server.`;
  }
}

export const ReadAloudError = Schema.Union([
  ReadAloudApiKeyMissingError,
  ReadAloudProviderError,
  ReadAloudUnsupportedEngineError,
]);
export type ReadAloudError = typeof ReadAloudError.Type;
