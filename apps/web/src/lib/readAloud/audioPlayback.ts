import type { ReadAloudWordTiming } from "@t3tools/contracts";

export type WordTick = {
  readonly wordIndex: number;
  readonly charStart: number;
  readonly charEnd: number;
};

export type PlaybackHandle = {
  readonly pause: () => void;
  readonly resume: () => void;
  readonly stop: () => void;
  readonly isPaused: () => boolean;
  /**
   * Change speed mid-sentence. The <audio> element applies it immediately and
   * preserves pitch; Web Speech cannot re-rate a live utterance, so there it
   * takes effect on the next sentence.
   */
  readonly setRate: (rate: number) => void;
};

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/**
 * Play ElevenLabs audio through an <audio> element.
 *
 * Not Web Audio: `AudioBufferSourceNode.playbackRate` resamples, so speeding
 * up raises the pitch into chipmunk territory. `HTMLMediaElement` time-stretches
 * instead, holding pitch steady — which is the whole point of a speed control.
 * The desktop CSP allows `media-src blob:` for exactly this.
 *
 * Position comes straight from `currentTime`, which is already in media time,
 * so the word timings need no rate math at all.
 */
export async function playElevenLabsAudio(options: {
  readonly audioBase64: string;
  readonly mimeType?: string;
  readonly words: readonly ReadAloudWordTiming[];
  readonly rate?: number;
  readonly onWord: (tick: WordTick | null) => void;
  readonly onEnded: () => void;
  readonly onError: (message: string) => void;
}): Promise<PlaybackHandle> {
  const url = URL.createObjectURL(
    base64ToBlob(options.audioBase64, options.mimeType ?? "audio/mpeg"),
  );
  const element = new Audio(url);
  // Chromium honours the standard property; older WebKit needs the prefix.
  element.preservesPitch = true;
  (element as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
  element.playbackRate = options.rate ?? 1;

  let raf = 0;
  let stopped = false;
  let lastWord = -1;

  const release = () => {
    cancelAnimationFrame(raf);
    element.pause();
    element.removeAttribute("src");
    element.load();
    URL.revokeObjectURL(url);
  };

  const tick = () => {
    if (stopped) return;
    const elapsedMs = element.currentTime * 1000;
    let wordIndex = -1;
    for (let i = 0; i < options.words.length; i++) {
      const w = options.words[i]!;
      if (elapsedMs >= w.startMs && elapsedMs < w.endMs) {
        wordIndex = i;
        break;
      }
      if (elapsedMs >= w.endMs) wordIndex = i;
    }
    if (wordIndex !== lastWord) {
      lastWord = wordIndex;
      if (wordIndex >= 0) {
        const w = options.words[wordIndex]!;
        options.onWord({ wordIndex, charStart: w.charStart, charEnd: w.charEnd });
      } else {
        options.onWord(null);
      }
    }
    raf = requestAnimationFrame(tick);
  };

  element.addEventListener("ended", () => {
    if (stopped) return;
    cancelAnimationFrame(raf);
    options.onWord(null);
    options.onEnded();
  });
  element.addEventListener("error", () => {
    if (stopped) return;
    stopped = true;
    release();
    options.onError("Could not play synthesized speech");
  });

  try {
    await element.play();
  } catch (cause) {
    release();
    throw cause instanceof Error ? cause : new Error("Could not start audio playback");
  }
  raf = requestAnimationFrame(tick);

  return {
    pause: () => {
      if (stopped || element.paused) return;
      element.pause();
      cancelAnimationFrame(raf);
    },
    resume: () => {
      if (stopped || !element.paused) return;
      void element.play().catch(() => options.onError("Could not resume playback"));
      raf = requestAnimationFrame(tick);
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      release();
      options.onWord(null);
    },
    isPaused: () => element.paused,
    setRate: (next: number) => {
      if (stopped) return;
      // currentTime is media time, so a rate change needs no rebasing — the
      // highlight stays aligned on its own.
      element.playbackRate = next;
    },
  };
}

export function playWebSpeech(options: {
  readonly text: string;
  readonly rate?: number;
  readonly onWord: (tick: WordTick | null) => void;
  readonly onEnded: () => void;
  readonly onError: (message: string) => void;
}): PlaybackHandle {
  const utterance = new SpeechSynthesisUtterance(options.text);
  utterance.rate = options.rate ?? 1;
  let paused = false;
  let stopped = false;

  utterance.onboundary = (event) => {
    if (stopped) return;
    if (event.name !== "word") return;
    const charStart = event.charIndex;
    const charEnd = charStart + (event.charLength || 1);
    options.onWord({ wordIndex: charStart, charStart, charEnd });
  };
  utterance.onend = () => {
    if (stopped) return;
    options.onWord(null);
    options.onEnded();
  };
  utterance.onerror = (event) => {
    if (stopped || event.error === "interrupted" || event.error === "canceled") return;
    options.onError(event.error || "speech synthesis failed");
  };

  speechSynthesis.speak(utterance);

  return {
    pause: () => {
      if (stopped) return;
      paused = true;
      speechSynthesis.pause();
    },
    resume: () => {
      if (stopped) return;
      paused = false;
      speechSynthesis.resume();
    },
    stop: () => {
      stopped = true;
      speechSynthesis.cancel();
      options.onWord(null);
    },
    isPaused: () => paused,
    setRate: () => {
      // SpeechSynthesisUtterance.rate is read-only once speaking has started;
      // ReadAloudSurface passes the current rate into the next sentence.
    },
  };
}
