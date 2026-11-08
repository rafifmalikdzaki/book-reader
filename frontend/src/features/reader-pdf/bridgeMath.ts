/** Pure helpers behind the PDF bridge (hash, page and bubble maths). */

/** `#p12` -> 12; anything else (incl. PDF.js's own `#page=12`) -> 0. */
export function parsePageHash(hash: string): number {
  const match = /#p(\d+)/.exec(hash);
  return match ? Number(match[1]) || 0 : 0;
}

export function clampPage(value: unknown): number {
  return Math.max(1, Math.floor(Number(value) || 1));
}

/** Deep-link precedence: `#p<n>` wins over the server's page, which wins over page 1. */
export function initialPage(hash: string, bookPage: number | null | undefined): number {
  return parsePageHash(hash) || Number(bookPage) || 1;
}

/** Page of the closest `.page[data-page-number]` ancestor of a selection node, else null. */
export function pageFromNode(node: Node | null): number | null {
  const element = node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
  const pageElement = element?.closest<HTMLElement>('.page[data-page-number]');
  if (!pageElement) return null;
  const page = Number(pageElement.dataset.pageNumber);
  return Number.isFinite(page) && page > 0 ? page : null;
}

/**
 * The viewer URL with its `#page=` fragment set to the page the reader opens on. The server
 * only knows the saved/`?page=` page; PDF.js applies its own initial `#page=` after
 * `pagesinit`, which would otherwise override a `#p<n>` deep link that differs from it.
 */
export function viewerSrcForPage(viewerUrl: string, page: number): string {
  const base = viewerUrl.split('#')[0] ?? viewerUrl;
  return `${base}#page=${clampPage(page)}`;
}

export interface BubblePosition {
  left: number;
  top: number;
}

/**
 * Viewport position for the "+ Note" bubble: centred above the selection (whose rect is in
 * iframe coordinates, so the iframe's own offset is added), kept 10px inside the window.
 */
export function bubblePosition(
  frameRect: Pick<DOMRect, 'left' | 'top'>,
  selectionRect: Pick<DOMRect, 'left' | 'top' | 'width'>,
  bubbleWidth: number,
  windowWidth: number,
): BubblePosition {
  const width = bubbleWidth || 74;
  const left = Math.min(
    windowWidth - width - 10,
    Math.max(10, frameRect.left + selectionRect.left + selectionRect.width / 2 - width / 2),
  );
  const top = Math.max(10, frameRect.top + selectionRect.top - 42);
  return { left, top };
}
