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
};

let owner: ReadAloudOwner | null = null;
let snapshot: ReadAloudSnapshot | null = null;
const listeners = new Set<() => void>();

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
