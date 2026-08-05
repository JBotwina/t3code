import { rangeFromTextOffsets } from "./domRanges";

export type HighlightRect = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Rounded highlights need real boxes rather than the CSS Custom Highlight API:
 * ::highlight() only honours color, background-color and text-decoration, so a
 * border-radius there is silently dropped. These rects are painted as absolutely
 * positioned divs behind the text instead.
 *
 * getClientRects() yields one rect per text fragment, which would round the
 * corners at every inline-element boundary mid-sentence, so fragments sharing a
 * line are merged into one band first. Two fragments count as the same line when
 * their vertical centres are closer than half the shorter one's height — a plain
 * comparison of tops mis-groups the taller boxes that inline code chips produce.
 */
export function highlightRects(
  root: HTMLElement,
  start: number,
  end: number,
  inflateX = 0,
  inflateY = 0,
): HighlightRect[] {
  const range = rangeFromTextOffsets(root, start, end);
  if (!range) return [];

  const fragments = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0.5 && rect.height > 0.5,
  );
  if (fragments.length === 0) return [];

  const lines: { top: number; bottom: number; left: number; right: number }[] = [];
  for (const rect of fragments) {
    const centre = (rect.top + rect.bottom) / 2;
    const line = lines.find(
      (candidate) =>
        Math.abs((candidate.top + candidate.bottom) / 2 - centre) * 2 <
        Math.min(candidate.bottom - candidate.top, rect.height),
    );
    if (line) {
      line.top = Math.min(line.top, rect.top);
      line.bottom = Math.max(line.bottom, rect.bottom);
      line.left = Math.min(line.left, rect.left);
      line.right = Math.max(line.right, rect.right);
    } else {
      lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
    }
  }

  // Both sets of coordinates are viewport-relative, so the difference holds at
  // any scroll offset; the overlay is a child of root and scrolls with it.
  const rootRect = root.getBoundingClientRect();
  return lines.map((line) => ({
    top: line.top - rootRect.top - inflateY,
    left: line.left - rootRect.left - inflateX,
    width: line.right - line.left + inflateX * 2,
    height: line.bottom - line.top + inflateY * 2,
  }));
}
