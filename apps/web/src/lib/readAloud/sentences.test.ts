import { describe, expect, it } from "vite-plus/test";

import { sentenceIndexAt, splitSentences } from "./sentences";

describe("splitSentences", () => {
  it("splits on sentence boundaries", () => {
    const spans = splitSentences("Hello world. Next one! Final?");
    expect(spans.map((s) => s.text)).toEqual(["Hello world.", "Next one!", "Final?"]);
  });

  it("maps offsets to sentences", () => {
    const spans = splitSentences("Aaa. Bbb.");
    expect(sentenceIndexAt(spans, 0)).toBe(0);
    expect(sentenceIndexAt(spans, 5)).toBe(1);
  });
});
