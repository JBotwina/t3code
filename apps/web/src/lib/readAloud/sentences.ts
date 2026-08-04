export type SentenceSpan = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

function pushSpan(text: string, sliceStart: number, sliceEnd: number, spans: SentenceSpan[]) {
  const raw = text.slice(sliceStart, sliceEnd);
  const leading = raw.match(/^\s*/)?.[0].length ?? 0;
  const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
  const start = sliceStart + leading;
  const end = sliceStart + raw.length - trailing;
  if (end <= start) return;
  const sentence = text.slice(start, end);
  if (!sentence.trim()) return;
  spans.push({ start, end, text: sentence });
}

/**
 * Split plain text into sentence spans (character offsets into `text`).
 * A boundary is terminal punctuation followed by whitespace or end-of-text,
 * so decimals ("v2.5") and inline dots don't split.
 */
export function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const boundary = /[.!?…]+(?=\s|$)/g;
  let sliceStart = 0;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[0].length;
    pushSpan(text, sliceStart, end, spans);
    sliceStart = end;
  }
  pushSpan(text, sliceStart, text.length, spans);
  return spans;
}

export function sentenceIndexAt(spans: readonly SentenceSpan[], offset: number): number {
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!;
    if (offset >= s.start && offset < s.end) return i;
    if (offset === s.end && i === spans.length - 1) return i;
  }
  // nearest preceding
  for (let i = spans.length - 1; i >= 0; i--) {
    if (offset >= spans[i]!.start) return i;
  }
  return 0;
}

/**
 * Elements treated as sentence containers when collecting spans from rendered
 * markdown. Each block ends any sentence in progress, so list items and
 * headings become their own utterances.
 */
const BLOCK_SELECTOR = "p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,dt,dd,figcaption";

/**
 * Collect sentence spans from a rendered DOM subtree. Offsets index into the
 * concatenation of all text nodes under `root` (the same coordinate space as
 * rangeFromTextOffsets / textOffsetFromPoint). Text inside `pre` is skipped so
 * code blocks are never spoken or highlighted.
 */
export function collectSentenceSpans(root: HTMLElement): SentenceSpan[] {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const spans: SentenceSpan[] = [];

  let globalOffset = 0;
  let blockEl: Element | null = null;
  let blockStart = 0;
  let blockText = "";

  const flushBlock = () => {
    if (!blockText) return;
    for (const span of splitSentences(blockText)) {
      spans.push({
        start: blockStart + span.start,
        end: blockStart + span.end,
        text: span.text,
      });
    }
    blockText = "";
  };

  let node = walker.nextNode() as Text | null;
  while (node) {
    const parent = node.parentElement;
    const skip = Boolean(parent?.closest("pre"));
    if (!skip) {
      const block = parent?.closest(BLOCK_SELECTOR) ?? root;
      if (block !== blockEl) {
        flushBlock();
        blockEl = block;
        blockStart = globalOffset;
      }
      blockText += node.data;
    } else {
      flushBlock();
      blockEl = null;
    }
    globalOffset += node.data.length;
    node = walker.nextNode() as Text | null;
  }
  flushBlock();
  return spans;
}
