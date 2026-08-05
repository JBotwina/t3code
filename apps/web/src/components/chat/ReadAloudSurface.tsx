import {
  useCallback,
  useEffect,
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
import { rangeFromTextOffsets, textOffsetFromPoint } from "../../lib/readAloud/domRanges";
import {
  collectSentenceSpans,
  sentenceIndexAt,
  type SentenceSpan,
} from "../../lib/readAloud/sentences";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";

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
    clearHighlight(WORD_HIGHLIGHT);
    clearHighlight(ACTIVE_HIGHLIGHT);
    readAloudController.release(messageKey);
  }, [messageKey]);

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

  useEffect(
    () => () => {
      halt();
      clearHighlight(HOVER_HIGHLIGHT);
    },
    [halt],
  );

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
      {children}
    </div>
  );
}

class ReadAloudApiKeyMissing extends Error {
  constructor() {
    super("ElevenLabs API key is not configured.");
  }
}
