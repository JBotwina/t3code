import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { EnvironmentId, ReadAloudEngine, ReadAloudWordTiming } from "@t3tools/contracts";

import {
  playElevenLabsAudio,
  playWebSpeech,
  type PlaybackHandle,
} from "../../lib/readAloud/audioPlayback";
import { rangeFromTextOffsets, textOffsetFromPoint } from "../../lib/readAloud/domRanges";
import { sentenceIndexAt, splitSentences, type SentenceSpan } from "../../lib/readAloud/sentences";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";

type ActivePlayback = {
  readonly messageKey: string;
  readonly sentenceIndex: number;
  readonly sentence: SentenceSpan;
  readonly words: readonly ReadAloudWordTiming[];
  readonly handle: PlaybackHandle;
  readonly fullText: string;
};

const HOVER_HIGHLIGHT = "read-aloud-hover";
const WORD_HIGHLIGHT = "read-aloud-word";
const ACTIVE_HIGHLIGHT = "read-aloud-active";

function clearHighlight(name: string) {
  if (typeof CSS !== "undefined" && "highlights" in CSS) {
    CSS.highlights.delete(name);
  }
}

function setHighlight(name: string, range: Range | null) {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  if (!range) {
    CSS.highlights.delete(name);
    return;
  }
  // Highlight is a global in browsers that support CSS Custom Highlight API.
  const HighlightCtor = (globalThis as unknown as { Highlight: typeof Highlight }).Highlight;
  if (typeof HighlightCtor !== "function") return;
  CSS.highlights.set(name, new HighlightCtor(range));
}

export function ReadAloudSurface({
  messageKey,
  enabled,
  engine,
  environmentId,
  isStreaming,
  children,
}: {
  readonly messageKey: string;
  readonly enabled: boolean;
  readonly engine: ReadAloudEngine;
  readonly environmentId: EnvironmentId | null;
  readonly isStreaming: boolean;
  readonly children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const spansRef = useRef<SentenceSpan[]>([]);
  const fullTextRef = useRef("");
  const playbackRef = useRef<ActivePlayback | null>(null);
  const [activeSentence, setActiveSentence] = useState<number | null>(null);
  const [wordRange, setWordRange] = useState<{ start: number; end: number } | null>(null);
  const sessionCacheRef = useRef(
    new Map<
      string,
      { audioBase64: string; mimeType: string; words: readonly ReadAloudWordTiming[] }
    >(),
  );

  const synthesize = useAtomCommand(serverEnvironment.readAloudSynthesize, "read aloud synthesize");

  const recomputeSpans = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const text = root.innerText.replace(/\u00a0/g, " ");
    fullTextRef.current = text;
    spansRef.current = splitSentences(text);
  }, []);

  useEffect(() => {
    recomputeSpans();
  });

  const stopPlayback = useCallback(() => {
    playbackRef.current?.handle.stop();
    playbackRef.current = null;
    setActiveSentence(null);
    setWordRange(null);
    clearHighlight(WORD_HIGHLIGHT);
    clearHighlight(ACTIVE_HIGHLIGHT);
  }, []);

  // Escape / Space global when this surface has active playback or focus in chat
  useEffect(() => {
    if (!enabled || isStreaming) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest("[data-composer], [data-slot='composer']"))
      ) {
        return;
      }
      if (event.key === "Escape") {
        if (playbackRef.current) {
          event.preventDefault();
          stopPlayback();
        }
        return;
      }
      if (event.key === " " || event.code === "Space") {
        const active = playbackRef.current;
        if (!active || active.messageKey !== messageKey) return;
        event.preventDefault();
        if (active.handle.isPaused()) active.handle.resume();
        else active.handle.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, isStreaming, messageKey, stopPlayback]);

  // Paint active + word highlights
  useEffect(() => {
    const root = rootRef.current;
    if (!root || activeSentence === null) {
      clearHighlight(ACTIVE_HIGHLIGHT);
      clearHighlight(WORD_HIGHLIGHT);
      return;
    }
    const span = spansRef.current[activeSentence];
    if (!span) return;
    setHighlight(ACTIVE_HIGHLIGHT, rangeFromTextOffsets(root, span.start, span.end));
    if (wordRange) {
      // word offsets from TTS are relative to the sentence text
      const absStart = span.start + wordRange.start;
      const absEnd = span.start + wordRange.end;
      setHighlight(WORD_HIGHLIGHT, rangeFromTextOffsets(root, absStart, absEnd));
    } else {
      clearHighlight(WORD_HIGHLIGHT);
    }
  }, [activeSentence, wordRange]);

  const playSentence = useCallback(
    async (sentenceIndex: number) => {
      const root = rootRef.current;
      if (!root) return;
      recomputeSpans();
      const spans = spansRef.current;
      const sentence = spans[sentenceIndex];
      if (!sentence) return;

      // Toggle pause if same sentence
      const current = playbackRef.current;
      if (current && current.messageKey === messageKey && current.sentenceIndex === sentenceIndex) {
        if (current.handle.isPaused()) current.handle.resume();
        else current.handle.pause();
        return;
      }

      stopPlayback();
      setActiveSentence(sentenceIndex);

      const speakText = sentence.text;
      const cacheKey = `${engine}:${speakText}`;

      const onWord = (tick: { charStart: number; charEnd: number } | null) => {
        if (!tick) {
          setWordRange(null);
          return;
        }
        setWordRange({ start: tick.charStart, end: tick.charEnd });
      };

      const playNext = () => {
        const next = sentenceIndex + 1;
        if (next < spansRef.current.length) {
          void playSentence(next);
        } else {
          stopPlayback();
        }
      };

      const onError = (message: string) => {
        toastManager.add({ type: "error", title: message });
        stopPlayback();
      };

      try {
        if (engine === "system" || !environmentId) {
          const handle = playWebSpeech({
            text: speakText,
            onWord,
            onEnded: playNext,
            onError,
          });
          playbackRef.current = {
            messageKey,
            sentenceIndex,
            sentence,
            words: [],
            handle,
            fullText: speakText,
          };
          return;
        }

        let cached = sessionCacheRef.current.get(cacheKey);
        if (!cached) {
          const result = await synthesize({
            environmentId,
            input: { text: speakText },
          });
          if (result._tag !== "Success") {
            throw new Error("Could not synthesize speech");
          }
          cached = {
            audioBase64: result.value.audioBase64,
            mimeType: result.value.mimeType,
            words: result.value.words,
          };
          sessionCacheRef.current.set(cacheKey, cached);
        }

        // Prefetch next sentence (fire and forget)
        const nextSpan = spans[sentenceIndex + 1];
        if (nextSpan && environmentId) {
          const nextKey = `${engine}:${nextSpan.text}`;
          if (!sessionCacheRef.current.has(nextKey)) {
            void synthesize({ environmentId, input: { text: nextSpan.text } }).then((result) => {
              if (result._tag !== "Success") return;
              sessionCacheRef.current.set(nextKey, {
                audioBase64: result.value.audioBase64,
                mimeType: result.value.mimeType,
                words: result.value.words,
              });
            });
          }
        }

        const handle = await playElevenLabsAudio({
          audioBase64: cached.audioBase64,
          words: cached.words,
          onWord,
          onEnded: playNext,
          onError,
        });
        playbackRef.current = {
          messageKey,
          sentenceIndex,
          sentence,
          words: cached.words,
          handle,
          fullText: speakText,
        };
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : "Read aloud failed";
        if (message.includes("API key") || message.includes("ApiKey")) {
          toastManager.add({
            type: "error",
            title: "Configure an ElevenLabs API key in Settings → General → Read aloud",
          });
        } else {
          toastManager.add({ type: "error", title: message });
        }
        stopPlayback();
      }
    },
    [engine, environmentId, messageKey, recomputeSpans, stopPlayback, synthesize],
  );

  const onMouseMove = (event: ReactMouseEvent) => {
    if (!enabled || isStreaming) return;
    const root = rootRef.current;
    if (!root) return;
    const offset = textOffsetFromPoint(root, event.clientX, event.clientY);
    if (offset === null) {
      clearHighlight(HOVER_HIGHLIGHT);
      return;
    }
    const idx = sentenceIndexAt(spansRef.current, offset);
    const span = spansRef.current[idx];
    if (!span) {
      clearHighlight(HOVER_HIGHLIGHT);
      return;
    }
    // Don't paint hover over the active sentence (active highlight owns it)
    if (activeSentence === idx) {
      clearHighlight(HOVER_HIGHLIGHT);
      return;
    }
    setHighlight(HOVER_HIGHLIGHT, rangeFromTextOffsets(root, span.start, span.end));
  };

  const onMouseLeave = () => {
    clearHighlight(HOVER_HIGHLIGHT);
  };

  const onClick = (event: ReactMouseEvent) => {
    if (!enabled || isStreaming) return;
    // Don't steal link/code clicks
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.closest("a, button, input, textarea, pre, code")) return;
    }
    const root = rootRef.current;
    if (!root) return;
    const offset = textOffsetFromPoint(root, event.clientX, event.clientY);
    if (offset === null) return;
    const idx = sentenceIndexAt(spansRef.current, offset);
    event.preventDefault();
    void playSentence(idx);
  };

  // Invalidate session cache when engine changes
  useEffect(() => {
    sessionCacheRef.current.clear();
    stopPlayback();
  }, [engine, stopPlayback]);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  if (!enabled || isStreaming) {
    return <>{children}</>;
  }

  return (
    <div
      ref={rootRef}
      className="read-aloud-surface"
      data-read-aloud=""
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
