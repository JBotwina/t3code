/** Build a DOM Range covering [start, end) in the textContent of root. */
export function rangeFromTextOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    if (!startNode && offset + len > start) {
      startNode = node;
      startOffset = start - offset;
    }
    if (!endNode && offset + len >= end) {
      endNode = node;
      endOffset = end - offset;
      break;
    }
    offset += len;
    node = walker.nextNode() as Text | null;
  }

  if (!startNode || !endNode) return null;
  const range = document.createRange();
  try {
    range.setStart(startNode, Math.min(startOffset, startNode.data.length));
    range.setEnd(endNode, Math.min(endOffset, endNode.data.length));
  } catch {
    return null;
  }
  return range;
}

/** Map a client point to a character offset in root's textContent. */
export function textOffsetFromPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const doc = root.ownerDocument;
  // caretPositionFromPoint is the standard; caretRangeFromPoint is WebKit legacy.
  const anyDoc = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let node: Node | null = null;
  let offset = 0;
  if (typeof anyDoc.caretPositionFromPoint === "function") {
    const pos = anyDoc.caretPositionFromPoint(clientX, clientY);
    if (!pos) return null;
    node = pos.offsetNode;
    offset = pos.offset;
  } else if (typeof anyDoc.caretRangeFromPoint === "function") {
    const range = anyDoc.caretRangeFromPoint(clientX, clientY);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  } else {
    return null;
  }

  if (!root.contains(node)) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let textNode = walker.nextNode() as Text | null;
  while (textNode) {
    if (textNode === node) return total + offset;
    if (node.nodeType === Node.ELEMENT_NODE && textNode.parentElement?.contains(node)) {
      // clicked inside element containing this text — use start of text
      return total;
    }
    total += textNode.data.length;
    textNode = walker.nextNode() as Text | null;
  }

  // node is a text node not found? walk parents
  if (node.nodeType === Node.TEXT_NODE) {
    const walker2 = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    total = 0;
    textNode = walker2.nextNode() as Text | null;
    while (textNode) {
      if (textNode === node) return total + offset;
      total += textNode.data.length;
      textNode = walker2.nextNode() as Text | null;
    }
  }
  return null;
}
