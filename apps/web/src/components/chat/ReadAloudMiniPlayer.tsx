import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon, XIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import {
  READ_ALOUD_RATES,
  readAloudController,
  useReadAloudRate,
  useReadAloudSnapshot,
} from "../../lib/readAloud/controller";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { cn } from "~/lib/utils";

/** 1 → "1×", 1.25 → "1.25×"; trailing zeros read as noise at this size. */
function formatRate(rate: number): string {
  return `${rate}\u00d7`;
}

function SpeedMenu({ rate }: { readonly rate: number }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Playback speed: ${formatRate(rate)}`}
        title="Playback speed"
        className="flex h-6 min-w-9 items-center justify-center rounded-full px-1.5 text-[11px] text-muted-foreground tabular-nums transition-colors hover:bg-accent hover:text-foreground hover:cursor-pointer"
      >
        {formatRate(rate)}
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent align="end" sideOffset={6} className="min-w-24">
          <DropdownMenuRadioGroup
            value={String(rate)}
            onValueChange={(value) => readAloudController.setRate(Number(value))}
          >
            {READ_ALOUD_RATES.map((option) => (
              <DropdownMenuRadioItem key={option} value={String(option)} className="tabular-nums">
                {formatRate(option)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable ||
      target.closest("[data-composer], [data-slot='composer']") !== null)
  );
}

function PlayerButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40 hover:cursor-pointer",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Floating transport for read-aloud playback. Renders nothing while idle;
 * docks above the composer next to the scroll-to-end pill. Space toggles
 * pause, Escape stops (single global listener, active only during playback).
 */
export function ReadAloudMiniPlayer() {
  const snapshot = useReadAloudSnapshot();
  const rate = useReadAloudRate();
  const active = snapshot !== null;

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        readAloudController.stop();
        return;
      }
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        readAloudController.togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (!snapshot) return null;

  const { status, sentenceIndex, sentenceCount, sentenceText } = snapshot;

  return (
    <div
      role="group"
      aria-label="Read aloud controls"
      data-read-aloud-mini-player=""
      className="chat-composer-glass pointer-events-auto flex items-center gap-1 rounded-full border border-border/60 bg-card/95 py-1 pr-1.5 pl-2 shadow-lg"
    >
      <PlayerButton
        label="Previous sentence"
        disabled={sentenceIndex <= 0}
        onClick={() => readAloudController.previousSentence()}
      >
        <SkipBackIcon className="size-3.5" />
      </PlayerButton>
      <PlayerButton
        label={status === "paused" ? "Resume (Space)" : "Pause (Space)"}
        disabled={status === "loading"}
        onClick={() => readAloudController.togglePause()}
        className="size-7 bg-primary/15 text-foreground hover:bg-primary/25"
      >
        {status === "loading" ? (
          <Spinner className="size-3.5" />
        ) : status === "paused" ? (
          <PlayIcon className="size-3.5" />
        ) : (
          <PauseIcon className="size-3.5" />
        )}
      </PlayerButton>
      <PlayerButton
        label="Next sentence"
        disabled={sentenceIndex >= sentenceCount - 1}
        onClick={() => readAloudController.nextSentence()}
      >
        <SkipForwardIcon className="size-3.5" />
      </PlayerButton>
      <span className="max-w-52 min-w-0 truncate text-muted-foreground text-xs" aria-live="off">
        {sentenceText}
      </span>
      <span className="text-[10px] text-muted-foreground/70 tabular-nums">
        {sentenceIndex + 1}/{sentenceCount}
      </span>
      <SpeedMenu rate={rate} />
      <PlayerButton label="Stop reading (Esc)" onClick={() => readAloudController.stop()}>
        <XIcon className="size-3.5" />
      </PlayerButton>
    </div>
  );
}
