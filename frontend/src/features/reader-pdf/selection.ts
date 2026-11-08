import { pageFromNode } from './bridgeMath';
import type { Timers } from './timers';

export interface PdfSelection {
  page: number;
  quote: string;
  /** Selection rect in iframe coordinates. */
  rect: Pick<DOMRect, 'left' | 'top' | 'width'>;
}

export const MAX_QUOTE = 7800;

/**
 * The current text selection inside the PDF.js viewer container, or null when there is none
 * (collapsed, outside `#viewerContainer`, or whitespace only). `fallbackPage` is used when
 * the selection is not inside a `.page[data-page-number]`.
 */
export function readSelection(
  frame: HTMLIFrameElement,
  fallbackPage: () => number,
): PdfSelection | null {
  const selection = frame.contentWindow?.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const container = frame.contentDocument?.getElementById('viewerContainer');
  if (!container?.contains(range.commonAncestorContainer)) return null;
  const quote = selection.toString().trim().slice(0, MAX_QUOTE);
  if (!quote) return null;
  return {
    page: pageFromNode(range.commonAncestorContainer) ?? fallbackPage(),
    quote,
    rect: range.getBoundingClientRect(),
  };
}

/** mouseup (0ms), touchend (250ms), debounced selectionchange (200ms) -> `run`. */
export function bindSelectionEvents(doc: Document, run: () => void, timers: Timers): () => void {
  let changeTimer: ReturnType<typeof timers.later> | null = null;
  const onMouseUp = () => void timers.later(run, 0);
  const onTouchEnd = () => void timers.later(run, 250);
  const onChange = () => {
    timers.clear(changeTimer);
    changeTimer = timers.later(run, 200);
  };
  doc.addEventListener('mouseup', onMouseUp);
  doc.addEventListener('touchend', onTouchEnd);
  doc.addEventListener('selectionchange', onChange);
  return () => {
    doc.removeEventListener('mouseup', onMouseUp);
    doc.removeEventListener('touchend', onTouchEnd);
    doc.removeEventListener('selectionchange', onChange);
  };
}
