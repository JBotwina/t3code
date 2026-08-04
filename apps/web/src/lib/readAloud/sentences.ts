export type SentenceSpan = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

/** Split plain text into sentence spans (character offsets into `text`). */
export function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const re = /[^.!?]+(?:[.!?]+|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const leading = raw.match(/^\s*/)?.[0].length ?? 0;
    const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
    const start = match.index + leading;
    const end = match.index + raw.length - trailing;
    if (end <= start) continue;
    const sentence = text.slice(start, end);
    if (!sentence.trim()) continue;
    spans.push({ start, end, text: sentence });
  }
  if (spans.length === 0 && text.trim()) {
    spans.push({ start: 0, end: text.length, text: text.trim() });
  }
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
