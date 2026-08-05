import { MessagesSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Anchor = { readonly x: number; readonly y: number; readonly text: string };

const MIN_SELECTION_LENGTH = 8;

function readSelectionAnchor(container: HTMLElement | null): Anchor | null {
  const selection = window.getSelection();
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().trim();
  if (text.length < MIN_SELECTION_LENGTH) return null;
  const range = selection.getRangeAt(0);
  // Selections that start outside the timeline (the composer, a panel) are
  // somebody else's business.
  if (!container.contains(range.commonAncestorContainer)) return null;
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { x: rect.left + rect.width / 2, y: rect.top, text };
}

/**
 * Floating "Ask in side chat" affordance for selected transcript text.
 *
 * Rendered as a fixed-position button rather than a native context menu so it
 * behaves the same in the browser and the desktop shell — the desktop context
 * menu goes through the Electron bridge, which the web build has no answer for.
 * Right-clicking a selection opens the same button at the pointer.
 */
export function SideChatSelectionAction({
  containerRef,
  disabled,
  onOpen,
}: {
  readonly containerRef: React.RefObject<HTMLElement | null>;
  readonly disabled: boolean;
  readonly onOpen: (selection: string) => void;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const refresh = useCallback(() => {
    if (disabled) {
      setAnchor(null);
      return;
    }
    setAnchor(readSelectionAnchor(containerRef.current));
  }, [containerRef, disabled]);

  useEffect(() => {
    if (disabled) return;
    const container = containerRef.current;
    if (!container) return;
    const onMouseUp = () => window.setTimeout(refresh, 0);
    const onContextMenu = (event: MouseEvent) => {
      const next = readSelectionAnchor(container);
      if (!next) return;
      event.preventDefault();
      setAnchor({ ...next, x: event.clientX, y: event.clientY });
    };
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setAnchor(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnchor(null);
    };
    container.addEventListener("mouseup", onMouseUp);
    container.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [containerRef, disabled, refresh]);

  if (!anchor) return null;

  return (
    <button
      type="button"
      // Pointer-down rather than click: click would land after the browser has
      // already collapsed the selection.
      onPointerDown={(event) => {
        event.preventDefault();
        onOpen(anchor.text);
        setAnchor(null);
        window.getSelection()?.removeAllRanges();
      }}
      style={{ left: anchor.x, top: Math.max(8, anchor.y - 40) }}
      className="chat-composer-glass -translate-x-1/2 fixed z-50 flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs shadow-lg hover:cursor-pointer hover:text-foreground"
    >
      <MessagesSquare className="size-3.5" />
      Ask in side chat
    </button>
  );
}
