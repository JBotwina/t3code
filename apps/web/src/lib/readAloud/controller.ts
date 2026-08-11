import { useSyncExternalStore } from "react";
import type { ReadAloudWordTiming } from "@t3tools/contracts";

export type ReadAloudStatus = "loading" | "playing" | "paused";

export type ReadAloudSnapshot = {
  readonly status: ReadAloudStatus;
  readonly messageKey: string;
  readonly sentenceIndex: number;
  readonly sentenceCount: number;
  readonly sentenceText: string;
};

/**
 * Commands a ReadAloudSurface registers when it starts playback. Exactly one
 * surface owns playback at a time; claiming halts the previous owner.
 */
export type ReadAloudOwner = {
  readonly messageKey: string;
  readonly playSentence: (index: number) => void;
  readonly pause: () => void;
  readonly resume: () => void;
  /** Stop audio, clear highlights, and release the claim. */
  readonly halt: () => void;
  readonly setRate: (rate: number) => void;
};

/**
 * Which transcript the user is reading. Autoplay and the toggle shortcut both
 * act on "the newest reply in the conversation I am looking at", and the main
 * timeline and a side chat are on screen at the same time — so something has
 * to say which one that is. Focus does.
 */
export type ReadAloudScope = "timeline" | "side-chat";

/** The newest reply in a scope, and how to start reading it. */
type LatestSurface = {
  readonly messageKey: string;
  readonly play: () => void;
};

let owner: ReadAloudOwner | null = null;
let snapshot: ReadAloudSnapshot | null = null;
let activeScope: ReadAloudScope = "timeline";
const latestByScope = new Map<ReadAloudScope, LatestSurface>();
const listeners = new Set<() => void>();

// ── Playback rate ──────────────────────────────────────────────

export const READ_ALOUD_RATES = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5] as const;
export const DEFAULT_READ_ALOUD_RATE = 1;
const RATE_STORAGE_KEY = "t3code:read-aloud-rate";

function readStoredRate(): number {
  if (typeof localStorage === "undefined") return DEFAULT_READ_ALOUD_RATE;
  try {
    const raw = Number.parseFloat(localStorage.getItem(RATE_STORAGE_KEY) ?? "");
    return READ_ALOUD_RATES.includes(raw as (typeof READ_ALOUD_RATES)[number])
      ? raw
      : DEFAULT_READ_ALOUD_RATE;
  } catch {
    // Private mode or a blocked storage partition; the default is fine.
    return DEFAULT_READ_ALOUD_RATE;
  }
}

let rate = readStoredRate();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const readAloudController = {
  claim(next: ReadAloudOwner) {
    if (owner && owner.messageKey !== next.messageKey) owner.halt();
    owner = next;
  },
  publish(next: ReadAloudSnapshot) {
    snapshot = next;
    emit();
  },
  release(messageKey: string) {
    if (owner?.messageKey !== messageKey) return;
    owner = null;
    snapshot = null;
    emit();
  },
  stop() {
    owner?.halt();
  },
  togglePause() {
    if (!owner || !snapshot) return;
    if (snapshot.status === "paused") owner.resume();
    else if (snapshot.status === "playing") owner.pause();
  },
  nextSentence() {
    if (!owner || !snapshot) return;
    owner.playSentence(snapshot.sentenceIndex + 1);
  },
  previousSentence() {
    if (!owner || !snapshot) return;
    owner.playSentence(Math.max(0, snapshot.sentenceIndex - 1));
  },
  activeMessageKey(): string | null {
    return snapshot?.messageKey ?? null;
  },

  // ── Scope and the newest reply ───────────────────────────────

  activeScope(): ReadAloudScope {
    return activeScope;
  },
  /** Called when a transcript takes focus or is clicked into. */
  setActiveScope(scope: ReadAloudScope) {
    activeScope = scope;
  },
  /**
   * Registered by the surface holding the newest reply in a scope, and only
   * while it is readable. Returns the unregister.
   */
  registerLatest(scope: ReadAloudScope, surface: LatestSurface): () => void {
    latestByScope.set(scope, surface);
    return () => {
      if (latestByScope.get(scope) === surface) latestByScope.delete(scope);
    };
  },
  /**
   * The shortcut: stop whatever is speaking, or start the newest reply in the
   * transcript being read. Deliberately asymmetric — stopping should work on
   * any message, including an older one the user clicked into, while starting
   * only ever picks the newest.
   */
  toggleLatest() {
    if (owner) {
      owner.halt();
      return;
    }
    latestByScope.get(activeScope)?.play();
  },
  rate(): number {
    return rate;
  },
  setRate(next: number) {
    if (next === rate) return;
    rate = next;
    try {
      localStorage?.setItem(RATE_STORAGE_KEY, String(next));
    } catch {
      // Non-persistent is still usable for this session.
    }
    owner?.setRate(next);
    emit();
  },
};

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot(): ReadAloudSnapshot | null {
  return null;
}

export function useReadAloudSnapshot(): ReadAloudSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getRate() {
  return rate;
}

function getServerRate() {
  return DEFAULT_READ_ALOUD_RATE;
}

export function useReadAloudRate(): number {
  return useSyncExternalStore(subscribe, getRate, getServerRate);
}

// ── Synthesized-audio cache ────────────────────────────────────
// Shared across messages so re-reading a sentence never re-bills the
// ElevenLabs key. Base64 mp3 is ~100KB/sentence, so keep a small cap.

export type CachedAudio = {
  readonly audioBase64: string;
  readonly mimeType: string;
  readonly words: readonly ReadAloudWordTiming[];
};

const AUDIO_CACHE_LIMIT = 32;
const audioCache = new Map<string, CachedAudio>();

export function getCachedAudio(key: string): CachedAudio | undefined {
  const hit = audioCache.get(key);
  if (hit) {
    // refresh recency
    audioCache.delete(key);
    audioCache.set(key, hit);
  }
  return hit;
}

export function setCachedAudio(key: string, value: CachedAudio) {
  if (!audioCache.has(key) && audioCache.size >= AUDIO_CACHE_LIMIT) {
    const oldest = audioCache.keys().next().value;
    if (oldest !== undefined) audioCache.delete(oldest);
  }
  audioCache.set(key, value);
}

export function hasCachedAudio(key: string): boolean {
  return audioCache.has(key);
}
