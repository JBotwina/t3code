import {
  READ_ALOUD_ELEVENLABS_API_KEY_SECRET_NAME,
  READ_ALOUD_INWORLD_API_KEY_SECRET_NAME,
  ReadAloudApiKeyMissingError,
  type ReadAloudProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

type ProviderKeySource = {
  readonly secretName: string;
  /** Checked in order, ahead of the secret store, so a deployment can inject keys. */
  readonly envVars: ReadonlyArray<string>;
};

const KEY_SOURCES: Record<ReadAloudProvider, ProviderKeySource> = {
  elevenlabs: {
    secretName: READ_ALOUD_ELEVENLABS_API_KEY_SECRET_NAME,
    envVars: ["ELEVENLABS_API_KEY", "T3_ELEVENLABS_API_KEY"],
  },
  inworld: {
    secretName: READ_ALOUD_INWORLD_API_KEY_SECRET_NAME,
    envVars: ["INWORLD_API_KEY", "T3_INWORLD_API_KEY"],
  },
};

const utf8Decoder = new TextDecoder();

function apiKeyFromEnv(provider: ReadAloudProvider): string | undefined {
  for (const name of KEY_SOURCES[provider].envVars) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export const hasApiKey = (
  provider: ReadAloudProvider,
): Effect.Effect<boolean, never, ServerSecretStore.ServerSecretStore> =>
  Effect.gen(function* () {
    if (apiKeyFromEnv(provider)) return true;
    const secretStore = yield* ServerSecretStore.ServerSecretStore;
    const secret = yield* secretStore
      .get(KEY_SOURCES[provider].secretName)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    return Option.isSome(secret);
  });

export const setApiKey = (
  provider: ReadAloudProvider,
  apiKey: string | null,
): Effect.Effect<void, never, ServerSecretStore.ServerSecretStore> =>
  Effect.gen(function* () {
    const secretStore = yield* ServerSecretStore.ServerSecretStore;
    const secretName = KEY_SOURCES[provider].secretName;
    const trimmed = apiKey?.trim() ?? "";
    if (!trimmed) {
      yield* secretStore.remove(secretName).pipe(Effect.ignore);
      return;
    }
    yield* secretStore.set(secretName, new TextEncoder().encode(trimmed)).pipe(Effect.orDie);
  });

export const resolveApiKey = (
  provider: ReadAloudProvider,
): Effect.Effect<string, ReadAloudApiKeyMissingError, ServerSecretStore.ServerSecretStore> =>
  Effect.gen(function* () {
    const fromEnv = apiKeyFromEnv(provider);
    if (fromEnv) return fromEnv;

    const secretStore = yield* ServerSecretStore.ServerSecretStore;
    const secret = yield* secretStore
      .get(KEY_SOURCES[provider].secretName)
      .pipe(Effect.mapError(() => new ReadAloudApiKeyMissingError({ provider })));
    if (Option.isNone(secret)) {
      return yield* new ReadAloudApiKeyMissingError({ provider });
    }
    return utf8Decoder.decode(secret.value).trim();
  });
