/**
 * Resolves what a side chat should quote when the user asks for one by keyboard
 * rather than by selecting text and clicking the button.
 *
 * The pointer is the cursor here, so the pointer position has to be remembered
 * between moves: a keydown carries no coordinates, and by the time it arrives
 * the only record of what the user was looking at is where the mouse stopped.
 */

/** The blocks a reader would call "a section" — the unit a quote snaps to. */
const BLOCK_SELECTOR = "p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, td, th, figure";

/** Short enough to be a stray word or a bullet marker, not a passage. */
const MIN_QUOTE_LENGTH = 8;

let pointerX: number | null = null;
let pointerY: number | null = null;
let tracking = false;

function onPointerMove(event: PointerEvent) {
  pointerX = event.clientX;
  pointerY = event.clientY;
}

/** Idempotent; the listener lives as long as the chat view that started it. */
export function startSideChatPointerTracking(): () => void {
  if (tracking) return () => {};
  tracking = true;
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  return () => {
    tracking = false;
    window.removeEventListener("pointermove", onPointerMove);
  };
}

function selectionQuote(container: HTMLElement): string | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const text = selection.toString().trim();
  return text.length >= MIN_QUOTE_LENGTH ? text : null;
}

function hoveredQuote(container: HTMLElement): string | null {
  if (pointerX === null || pointerY === null) return null;
  const target = document.elementFromPoint(pointerX, pointerY);
  if (!(target instanceof HTMLElement) || !container.contains(target)) return null;

  // Nearest block first, then the whole reply: hovering the gap between two
  // paragraphs should still quote something rather than nothing.
  const block = target.closest(BLOCK_SELECTOR);
  const message = target.closest("[data-read-aloud]");
  for (const candidate of [block, message]) {
    if (!candidate || !container.contains(candidate)) continue;
    const text = (candidate instanceof HTMLElement ? candidate.innerText : candidate.textContent)
      ?.trim()
      .replace(/\n{3,}/g, "\n\n");
    if (text && text.length >= MIN_QUOTE_LENGTH) return text;
  }
  return null;
}

/**
 * What to quote right now: an explicit selection if the user made one,
 * otherwise the section under the pointer. Null when neither yields a passage
 * worth opening a conversation about.
 */
export function resolveSideChatQuote(container: HTMLElement | null): string | null {
  if (!container) return null;
  return selectionQuote(container) ?? hoveredQuote(container);
}
