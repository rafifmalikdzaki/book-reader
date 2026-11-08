/** Port of the inline script in book_md.html: where a selection sits in the document. */

const HEADINGS = 'h1, h2, h3, h4';
const BLOCKS = 'p, li, pre, table, blockquote';

/** The last two headings before `node`, joined as "H2 › H3" (`''` before the first one). */
export function sectionPath(article: HTMLElement, node: Node): string {
  const found = Array.from(article.querySelectorAll(HEADINGS)).filter(
    (heading) => heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  return found
    .slice(-2)
    .map((heading) => (heading.textContent ?? '').trim())
    .join(' › ');
}

/** 1-based index of the block (paragraph, item, code, table, quote) holding `node`. */
export function paragraphIndex(article: HTMLElement, node: Node): number | null {
  const blocks = Array.from(article.querySelectorAll(BLOCKS));
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const block = element?.closest(BLOCKS);
  const index = block ? blocks.indexOf(block) : -1;
  return index >= 0 ? index + 1 : null;
}

/** First line number of the `L<n>` block at or before `target` (legacy deep-link rule). */
export function lineAnchor(article: HTMLElement, target: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  for (const element of article.querySelectorAll<HTMLElement>('[id^="L"]')) {
    const line = parseInt(element.id.slice(1), 10);
    if (!Number.isNaN(line) && line <= target) best = element;
  }
  return best;
}

/** `#L12` -> 12 (the legacy regexp is unanchored, so `#xL12` also matched). */
export function parseLineHash(hash: string): number | null {
  const match = /#L(\d+)/.exec(hash);
  return match ? parseInt(match[1] ?? '', 10) : null;
}
