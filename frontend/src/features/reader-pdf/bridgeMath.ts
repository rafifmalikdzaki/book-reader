/** Pure helpers behind the PDF reader (hash, page, zoom, search highlight, and bubble maths). */

export type ZoomMode = 'page-width' | 'page-fit' | number;

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const DEFAULT_INTRINSIC_WIDTH = 612;
export const DEFAULT_INTRINSIC_HEIGHT = 792;
export const PAGE_OVERSCAN = 2;

/** `#p12` -> 12; anything else (incl. PDF.js's own `#page=12`) -> 0. */
export function parsePageHash(hash: string): number {
  const match = /#p(\d+)/.exec(hash);
  return match ? Number(match[1]) || 0 : 0;
}

export function clampPage(value: unknown, maxPage?: number | null): number {
  const page = Math.max(1, Math.floor(Number(value) || 1));
  if (typeof maxPage === 'number' && Number.isFinite(maxPage) && maxPage >= 1) {
    return Math.min(page, Math.floor(maxPage));
  }
  return page;
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
 * The viewer URL with its `#page=` fragment set to the page the reader opens on. Kept for
 * compatibility with legacy tests and deep-link helpers.
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
 * Viewport position for the "+ Note" bubble: centred above the selection, kept 10px inside
 * the window. When selections live in the main document, pass `{ left: 0, top: 0 }` as
 * `frameRect`.
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

export function parseZoomValue(raw: string): ZoomMode {
  if (raw === 'page-width' || raw === 'page-fit') return raw;
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0.25 && num <= 4 ? num : 'page-width';
}

export function formatZoomValue(zoom: ZoomMode): string {
  return typeof zoom === 'number' ? String(zoom) : zoom;
}

export function stepZoom(currentScale: number, direction: 1 | -1): number {
  const safe = Number.isFinite(currentScale) && currentScale > 0 ? currentScale : 1;
  if (direction > 0) {
    for (const step of ZOOM_STEPS) {
      if (step > safe + 0.01) return step;
    }
    return 2;
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i -= 1) {
    const step = ZOOM_STEPS[i];
    if (step !== undefined && step < safe - 0.01) return step;
  }
  return 0.5;
}

export function nextRotation(current: number): number {
  const normalized = ((Math.round(current / 90) * 90) % 360 + 360) % 360;
  return (normalized + 90) % 360;
}

export interface PageDimensionInput {
  containerWidth: number;
  containerHeight: number;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  zoom: ZoomMode;
  rotation?: number;
}

export interface PageDimensions {
  width: number;
  height: number;
  scale: number;
}

export function computePageDimensions({
  containerWidth,
  containerHeight,
  intrinsicWidth = DEFAULT_INTRINSIC_WIDTH,
  intrinsicHeight = DEFAULT_INTRINSIC_HEIGHT,
  zoom,
  rotation = 0,
}: PageDimensionInput): PageDimensions {
  const quarterTurns = Math.abs(Math.round(rotation / 90)) % 2;
  const baseW = quarterTurns === 1 ? intrinsicHeight : intrinsicWidth;
  const baseH = quarterTurns === 1 ? intrinsicWidth : intrinsicHeight;
  const safeW = baseW > 0 ? baseW : DEFAULT_INTRINSIC_WIDTH;
  const safeH = baseH > 0 ? baseH : DEFAULT_INTRINSIC_HEIGHT;

  const availW = Math.max(280, (containerWidth || 820) - 48);
  const availH = Math.max(320, (containerHeight || 760) - 40);

  let scale = 1;
  if (zoom === 'page-width') {
    scale = Math.min(2.2, Math.max(0.45, availW / safeW));
  } else if (zoom === 'page-fit') {
    scale = Math.min(2.2, Math.max(0.4, Math.min(availW / safeW, availH / safeH)));
  } else {
    scale = Math.min(4, Math.max(0.25, zoom));
  }

  return {
    width: Math.round(safeW * scale),
    height: Math.round(safeH * scale),
    scale: Number(scale.toFixed(3)),
  };
}

export function isPageRendered(
  pageNumber: number,
  currentPage: number,
  overscan = PAGE_OVERSCAN,
): boolean {
  return Math.abs(pageNumber - currentPage) <= overscan;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escapes `text` for safe HTML rendering in `react-pdf`'s `customTextRenderer` and wraps
 * case-insensitive matches of `query` in `<mark>` tags.
 */
export function highlightSearchHtml(text: string, query: string): string {
  const needle = query.trim();
  if (!needle) return escapeHtml(text);
  const pattern = new RegExp(`(${escapeRegExp(needle)})`, 'gi');
  const parts = text.split(pattern);
  return parts
    .map((part, idx) => (idx % 2 === 1 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join('');
}
