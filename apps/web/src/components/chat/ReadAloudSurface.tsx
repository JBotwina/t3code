import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import * as Cause from "effect/Cause";
import type { EnvironmentId, ReadAloudEngine } from "@t3tools/contracts";

import {
  playElevenLabsAudio,
  playWebSpeech,
  type PlaybackHandle,
} from "../../lib/readAloud/audioPlayback";
import {
  getCachedAudio,
  hasCachedAudio,
  readAloudController,
  setCachedAudio,
  type ReadAloudStatus,
} from "../../lib/readAloud/controller";
import { textOffsetFromPoint } from "../../lib/readAloud/domRanges";
import { highlightRects, type HighlightRect } from "../../lib/readAloud/highlightRects";
import {
  collectSentenceSpans,
  sentenceIndexAt,
  type SentenceSpan,
} from "../../lib/readAloud/sentences";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";

/** Grown past the glyph box so the rounded band reads as a pill, not a tight box. */
const SENTENCE_INFLATE_X = 3;
const SENTENCE_INFLATE_Y = 2;
const WORD_INFLATE_X = 4;
const WORD_INFLATE_Y = 3;

type HighlightLayers = {
  readonly hover: readonly HighlightRect[];
  readonly active: readonly HighlightRect[];
  readonly word: readonly HighlightRect[];
};

const NO_HIGHLIGHTS: HighlightLayers = { hover: [], active: [], word: [] };

function HighlightBand({
  className,
  rects,
}: {
  readonly className: string;
  readonly rects: readonly HighlightRect[];
}) {
  return (
    <>
      {rects.map((rect) => (
        // One band per visual line, so its position is already a unique key.
        <div
          key={`${rect.top}:${rect.left}:${rect.width}`}
          className={className}
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      ))}
    </>
  );
}

/** Same-length whitespace normalization so TTS char offsets still map back. */
function speakableText(text: string): string {
  return text.replace(/\s/g, " ");
}

export function ReadAloudSurface({
  messageKey,
  enabled,
  engine,
  environmentId,
  children,
}: {
  readonly messageKey: string;
  readonly enabled: boolean;
  readonly engine: ReadAloudEngine;
  readonly environmentId: EnvironmentId | null;
  readonly children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const spansRef = useRef<SentenceSpan[]>([]);
  const handleRef = useRef<PlaybackHandle | null>(null);
  const playingIndexRef = useRef<number | null>(null);
  // Invalidates in-flight synthesize/decode when a newer play request lands.
  const playGenerationRef = useRef(0);
  const [activeSentence, setActiveSentence] = useState<number | null>(null);
  const [wordRange, setWordRange] = useState<{ start: number; end: number } | null>(null);
  const [hoverSentence, setHoverSentence] = useState<number | null>(null);
  const [highlights, setHighlights] = useState<HighlightLayers>(NO_HIGHLIGHTS);
  // Bumped whenever the surface reflows, so the measured rects are re-taken.
  const [layoutEpoch, setLayoutEpoch] = useState(0);

  const synthesize = useAtomCommand(serverEnvironment.readAloudSynthesize, "read aloud synthesize");

  const recomputeSpans = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    spansRef.current = collectSentenceSpans(root);
  }, []);

  const publish = useCallback(
    (status: ReadAloudStatus, sentenceIndex: number) => {
      const span = spansRef.current[sentenceIndex];
      readAloudController.publish({
        status,
        messageKey,
        sentenceIndex,
        sentenceCount: spansRef.current.length,
        sentenceText: span?.text ?? "",
      });
    },
    [messageKey],
  );

  const halt = useCallback(() => {
    playGenerationRef.current += 1;
    handleRef.current?.stop();
    handleRef.current = null;
    playingIndexRef.current = null;
    setActiveSentence(null);
    setWordRange(null);
    readAloudController.release(messageKey);
  }, [messageKey]);

  // Measure the hover, sentence and word bands. Layout effect so the rects land
  // in the same paint as the state change that caused them.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const active = activeSentence === null ? undefined : spansRef.current[activeSentence];
    // The active band owns its own sentence; painting hover under it too would
    // just darken the sentence whenever the pointer rests on what is playing.
    const hover =
      hoverSentence === activeSentence ? undefined : spansRef.current[hoverSentence ?? -1];
    setHighlights({
      hover: hover
        ? highlightRects(root, hover.start, hover.end, SENTENCE_INFLATE_X, SENTENCE_INFLATE_Y)
        : [],
      active: active
        ? highlightRects(root, active.start, active.end, SENTENCE_INFLATE_X, SENTENCE_INFLATE_Y)
        : [],
      word:
        active && wordRange
          ? // Word offsets from TTS are relative to the sentence text.
            highlightRects(
              root,
              active.start + wordRange.start,
              active.start + wordRange.end,
              WORD_INFLATE_X,
              WORD_INFLATE_Y,
            )
          : [],
    });
  }, [activeSentence, hoverSentence, wordRange, layoutEpoch]);

  // Wrapping changes with the panel width, and every measured rect goes stale
  // with it.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setLayoutEpoch((epoch) => epoch + 1));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const playSentence = useCallback(
    async (sentenceIndex: number) => {
      const root = rootRef.current;
      if (!root) return;
      recomputeSpans();
      const spans = spansRef.current;
      const sentence = spans[sentenceIndex];
      if (!sentence) {
        halt();
        return;
      }

      // Clicking the sentence that is already playing toggles pause.
      if (handleRef.current && playingIndexRef.current === sentenceIndex) {
        const handle = handleRef.current;
        if (handle.isPaused()) {
          handle.resume();
          publish("playing", sentenceIndex);
        } else {
          handle.pause();
          publish("paused", sentenceIndex);
        }
        return;
      }

      playGenerationRef.current += 1;
      const generation = playGenerationRef.current;
      handleRef.current?.stop();
      handleRef.current = null;
      playingIndexRef.current = null;
      setWordRange(null);
      setActiveSentence(sentenceIndex);

      readAloudController.claim({
        messageKey,
        playSentence: (index) => void playSentence(index),
        pause: () => {
          handleRef.current?.pause();
          if (playingIndexRef.current !== null) publish("paused", playingIndexRef.current);
        },
        resume: () => {
          handleRef.current?.resume();
          if (playingIndexRef.current !== null) publish("playing", playingIndexRef.current);
        },
        halt,
        setRate: (nextRate) => handleRef.current?.setRate(nextRate),
      });

      const speakText = speakableText(sentence.text);
      const cacheKey = `${engine}:${speakText}`;

      const onWord = (tick: { charStart: number; charEnd: number } | null) => {
        if (playGenerationRef.current !== generation) return;
        setWordRange(tick ? { start: tick.charStart, end: tick.charEnd } : null);
      };

      const playNext = () => {
        if (playGenerationRef.current !== generation) return;
        const next = sentenceIndex + 1;
        if (next < spansRef.current.length) {
          void playSentence(next);
        } else {
          halt();
        }
      };

      const onError = (message: string) => {
        if (playGenerationRef.current !== generation) return;
        toastManager.add({ type: "error", title: message });
        halt();
      };

      try {
        if (engine === "system" || !environmentId) {
          const handle = playWebSpeech({
            text: speakText,
            rate: readAloudController.rate(),
            onWord,
            onEnded: playNext,
            onError,
          });
          handleRef.current = handle;
          playingIndexRef.current = sentenceIndex;
          publish("playing", sentenceIndex);
          return;
        }

        publish("loading", sentenceIndex);

        let cached = getCachedAudio(cacheKey);
        if (!cached) {
          const result = await synthesize({
            environmentId,
            input: { text: speakText },
          });
          if (result._tag !== "Success") {
            const failure = result._tag === "Failure" ? Cause.squash(result.cause) : null;
            const tag =
              failure && typeof failure === "object" && "_tag" in failure
                ? String((failure as { _tag: unknown })._tag)
                : null;
            if (tag === "ReadAloudApiKeyMissingError") {
              throw new ReadAloudApiKeyMissing();
            }
            const detail =
              failure instanceof Error && failure.message ? failure.message : undefined;
            throw new Error(detail ?? "Could not synthesize speech");
          }
          cached = {
            audioBase64: result.value.audioBase64,
            mimeType: result.value.mimeType,
            words: result.value.words,
          };
          setCachedAudio(cacheKey, cached);
        }

        // Prefetch next sentence (fire and forget)
        const nextSpan = spans[sentenceIndex + 1];
        if (nextSpan) {
          const nextText = speakableText(nextSpan.text);
          const nextKey = `${engine}:${nextText}`;
          if (!hasCachedAudio(nextKey)) {
            void synthesize({ environmentId, input: { text: nextText } }).then((result) => {
              if (result._tag !== "Success") return;
              setCachedAudio(nextKey, {
                audioBase64: result.value.audioBase64,
                mimeType: result.value.mimeType,
                words: result.value.words,
              });
            });
          }
        }

        const handle = await playElevenLabsAudio({
          audioBase64: cached.audioBase64,
          mimeType: cached.mimeType,
          words: cached.words,
          rate: readAloudController.rate(),
          onWord,
          onEnded: playNext,
          onError,
        });
        if (playGenerationRef.current !== generation) {
          handle.stop();
          return;
        }
        handleRef.current = handle;
        playingIndexRef.current = sentenceIndex;
        publish("playing", sentenceIndex);
      } catch (error) {
        if (playGenerationRef.current !== generation) return;
        if (error instanceof ReadAloudApiKeyMissing) {
          toastManager.add({
            type: "error",
            title: "Configure an ElevenLabs API key in Settings → General → Read aloud",
          });
        } else {
          const message =
            error && typeof error === "object" && "message" in error
              ? String((error as { message: unknown }).message)
              : "Read aloud failed";
          toastManager.add({ type: "error", title: message });
        }
        halt();
      }
    },
    [engine, environmentId, halt, messageKey, publish, recomputeSpans, synthesize],
  );

  const onMouseEnter = () => {
    if (!enabled) return;
    recomputeSpans();
  };

  const onMouseMove = (event: ReactMouseEvent) => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;
    const offset = textOffsetFromPoint(root, event.clientX, event.clientY);
    if (offset === null) {
      setHoverSentence(null);
      return;
    }
    const idx = sentenceIndexAt(spansRef.current, offset);
    // Every pointer move lands here, so only re-measure when the sentence under
    // the cursor actually changes.
    setHoverSentence(spansRef.current[idx] ? idx : null);
  };

  const onMouseLeave = () => {
    setHoverSentence(null);
  };

  const onClick = (event: ReactMouseEvent) => {
    if (!enabled) return;
    // Don't steal link/code clicks
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.closest("a, button, input, textarea, pre, code")) return;
    }
    // Don't hijack text selection (click fires after a select-drag).
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const root = rootRef.current;
    if (!root) return;
    const offset = textOffsetFromPoint(root, event.clientX, event.clientY);
    if (offset === null) return;
    recomputeSpans();
    const idx = sentenceIndexAt(spansRef.current, offset);
    event.preventDefault();
    void playSentence(idx);
  };

  // Stop playback when the engine changes mid-read (the closure chain would
  // otherwise keep speaking with the old engine).
  const enginesSeen = useRef(engine);
  useEffect(() => {
    if (enginesSeen.current !== engine) {
      enginesSeen.current = engine;
      halt();
    }
  }, [engine, halt]);

  useEffect(() => () => halt(), [halt]);

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <div
      ref={rootRef}
      className="read-aloud-surface"
      data-read-aloud=""
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <div className="read-aloud-highlight-layer" aria-hidden="true">
        <HighlightBand className="read-aloud-band read-aloud-band-hover" rects={highlights.hover} />
        <HighlightBand
          className="read-aloud-band read-aloud-band-active"
          rects={highlights.active}
        />
        <HighlightBand className="read-aloud-band read-aloud-band-word" rects={highlights.word} />
      </div>
      {/* Positioned, and after the layer in DOM order, so the text paints over
          the bands without needing a z-index that would trap popovers inside a
          new stacking context. */}
      <div className="read-aloud-content">{children}</div>
    </div>
  );
}

class ReadAloudApiKeyMissing extends Error {
  constructor() {
    super("ElevenLabs API key is not configured.");
  }
}
