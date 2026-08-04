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
};

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Play ElevenLabs mp3 via Web Audio (avoids desktop CSP media-src blob block). */
export async function playElevenLabsAudio(options: {
  readonly audioBase64: string;
  readonly words: readonly ReadAloudWordTiming[];
  readonly onWord: (tick: WordTick | null) => void;
  readonly onEnded: () => void;
  readonly onError: (message: string) => void;
}): Promise<PlaybackHandle> {
  const ctx = new AudioContext();
  let source: AudioBufferSourceNode | null = null;
  let startedAt = 0;
  let pausedAt: number | null = null;
  let offsetWhenPaused = 0;
  let raf = 0;
  let stopped = false;
  let lastWord = -1;

  const buffer = await ctx.decodeAudioData(base64ToArrayBuffer(options.audioBase64));

  const tick = () => {
    if (stopped || pausedAt !== null) return;
    const elapsedMs = (ctx.currentTime - startedAt + offsetWhenPaused) * 1000;
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

  const startFrom = (offsetSec: number) => {
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (stopped || pausedAt !== null) return;
      cancelAnimationFrame(raf);
      options.onWord(null);
      options.onEnded();
    };
    startedAt = ctx.currentTime;
    offsetWhenPaused = offsetSec;
    source.start(0, offsetSec);
    raf = requestAnimationFrame(tick);
  };

  startFrom(0);

  return {
    pause: () => {
      if (stopped || pausedAt !== null || !source) return;
      pausedAt = ctx.currentTime;
      offsetWhenPaused += pausedAt - startedAt;
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source = null;
      cancelAnimationFrame(raf);
    },
    resume: () => {
      if (stopped || pausedAt === null) return;
      pausedAt = null;
      startFrom(offsetWhenPaused);
    },
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      try {
        source?.stop();
      } catch {
        // ignore
      }
      source = null;
      void ctx.close();
      options.onWord(null);
    },
    isPaused: () => pausedAt !== null,
  };
}

export function playWebSpeech(options: {
  readonly text: string;
  readonly onWord: (tick: WordTick | null) => void;
  readonly onEnded: () => void;
  readonly onError: (message: string) => void;
}): PlaybackHandle {
  const utterance = new SpeechSynthesisUtterance(options.text);
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
  };
}
