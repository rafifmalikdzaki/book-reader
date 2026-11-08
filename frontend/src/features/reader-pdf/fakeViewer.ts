/** Test-only: a fake `PDFViewerApplication` and helpers to plant it in a jsdom iframe. */
import { vi, type Mock } from 'vitest';

import type { PdfApp, PdfEvent, PdfEventListener, PdfFrameWindow } from './pdfApp';

export interface FakeViewer extends PdfApp {
  emit(name: string, event?: PdfEvent): void;
  listenerCount(): number;
  pageSets: number[];
  pdfViewer: PdfApp['pdfViewer'] & { update: Mock<() => void>; pagesCount: number };
  viewsManager: { isOpen: boolean; close: Mock<() => void> };
}

/**
 * `currentPageNumber` is an accessor whose setter emits `pagechanging` synchronously
 * (like PDF.js), so feedback loops show up as extra setter calls in `pageSets`.
 */
export function makeFakeViewer(pagesCount = 10): FakeViewer {
  const listeners = new Map<string, Set<PdfEventListener>>();
  const eventBus = {
    on: (name: string, fn: PdfEventListener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)?.add(fn);
    },
    off: (name: string, fn: PdfEventListener) => void listeners.get(name)?.delete(fn),
  };
  let page = 1;
  const pageSets: number[] = [];
  const pdfViewer = {
    pagesCount,
    update: vi.fn(),
    get currentPageNumber() {
      return page;
    },
    set currentPageNumber(value: number) {
      pageSets.push(value);
      if (value === page) return;
      page = value;
      emit('pagechanging', { pageNumber: value });
    },
  };
  function emit(name: string, event: PdfEvent = {}) {
    [...(listeners.get(name) ?? [])].forEach((fn) => fn(event));
  }
  return {
    eventBus,
    pdfViewer,
    viewsManager: { isOpen: true, close: vi.fn() },
    emit,
    pageSets,
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

export function installApp(frame: HTMLIFrameElement, app: Partial<PdfApp>): void {
  const doc = frame.contentDocument as Document;
  if (!doc.head) {
    // jsdom leaves an iframe document empty; the real viewer always has head and body.
    doc.open();
    doc.write('<!doctype html><html><head></head><body></body></html>');
    doc.close();
  }
  (frame.contentWindow as PdfFrameWindow).PDFViewerApplication = app;
}

/** A selection inside page `pageNumber` of the iframe document. */
export function selectText(
  frame: HTMLIFrameElement,
  options: { pageNumber: number | null; text: string; rect: { left: number; top: number; width: number } },
): void {
  const doc = frame.contentDocument as Document;
  const pageAttrs = options.pageNumber === null ? '' : ` class="page" data-page-number="${options.pageNumber}"`;
  doc.body.innerHTML = `<div id="viewerContainer"><div${pageAttrs}><span id="sel">x</span></div></div>`;
  const node = doc.getElementById('sel')?.firstChild as Node;
  const range = { commonAncestorContainer: node, getBoundingClientRect: () => options.rect };
  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => range,
    toString: () => options.text,
  };
  (frame.contentWindow as Window).getSelection = (() => selection) as unknown as Window['getSelection'];
}

export function clearSelection(frame: HTMLIFrameElement): void {
  const selection = { isCollapsed: true, rangeCount: 0, getRangeAt: () => null, toString: () => '' };
  (frame.contentWindow as Window).getSelection = (() => selection) as unknown as Window['getSelection'];
}
