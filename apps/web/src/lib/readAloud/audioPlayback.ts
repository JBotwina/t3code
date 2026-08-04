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
   * Change speed mid-sentence. Web Audio applies it immediately; Web Speech
   * cannot re-rate a live utterance, so it takes effect on the next sentence.
   */
  readonly setRate: (rate: number) => void;
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
  readonly rate?: number;
  readonly onWord: (tick: WordTick | null) => void;
  readonly onEnded: () => void;
  readonly onError: (message: string) => void;
}): Promise<PlaybackHandle> {
  const ctx = new AudioContext();
  let source: AudioBufferSourceNode | null = null;
  // Media position (in the audio's own timeline) at the last (re)start, plus
  // the wall clock reading then. Word timings are in media time, so playback
  // rate only shows up here as a multiplier on elapsed wall time.
  let mediaOffsetSec = 0;
  let wallStartedAt = 0;
  let rate = options.rate ?? 1;
  let paused = false;
  let raf = 0;
  let stopped = false;
  let lastWord = -1;
  // Stopping a source fires `onended`; without this, a pause or a rate change
  // would look like the sentence finished and advance to the next one.
  let sourceGeneration = 0;

  const buffer = await ctx.decodeAudioData(base64ToArrayBuffer(options.audioBase64));

  const mediaPositionSec = () =>
    paused ? mediaOffsetSec : mediaOffsetSec + (ctx.currentTime - wallStartedAt) * rate;

  const tick = () => {
    if (stopped || paused) return;
    const elapsedMs = mediaPositionSec() * 1000;
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

  const stopSource = () => {
    sourceGeneration += 1;
    try {
      source?.stop();
    } catch {
      // already stopped
    }
    source = null;
    cancelAnimationFrame(raf);
  };

  const startFrom = (offsetSec: number) => {
    sourceGeneration += 1;
    const generation = sourceGeneration;
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(ctx.destination);
    source.onended = () => {
      if (stopped || paused || generation !== sourceGeneration) return;
      cancelAnimationFrame(raf);
      options.onWord(null);
      options.onEnded();
    };
    mediaOffsetSec = offsetSec;
    wallStartedAt = ctx.currentTime;
    source.start(0, offsetSec);
    raf = requestAnimationFrame(tick);
  };

  startFrom(0);

  return {
    pause: () => {
      if (stopped || paused || !source) return;
      mediaOffsetSec = mediaPositionSec();
      paused = true;
      stopSource();
    },
    resume: () => {
      if (stopped || !paused) return;
      paused = false;
      startFrom(mediaOffsetSec);
    },
    stop: () => {
      stopped = true;
      stopSource();
      void ctx.close();
      options.onWord(null);
    },
    isPaused: () => paused,
    setRate: (next: number) => {
      if (stopped || next === rate) return;
      if (paused || !source) {
        rate = next;
        return;
      }
      // Rebase onto the current position first, or the elapsed-time math would
      // retroactively re-scale everything already played.
      const position = mediaPositionSec();
      rate = next;
      stopSource();
      startFrom(position);
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
