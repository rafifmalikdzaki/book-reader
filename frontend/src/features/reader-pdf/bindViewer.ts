import { clampPage } from './bridgeMath';
import type { PdfApp, PdfEventListener } from './pdfApp';
import { bindSelectionEvents, readSelection, type PdfSelection } from './selection';
import { createTimers } from './timers';

/** Injected into the viewer document (stays served from /static, not bundled). */
export const PDF_ROOM_CSS = '/static/pdf_room.css';
export const SIDEBAR_CLOSE_DELAYS_MS = [0, 250, 750, 1500];

export interface BindCallbacks {
  /** Read when the viewer is ready to jump, so a deep link set meanwhile still wins. */
  getInitialPage(): number;
  /** `record` is false for the initial jump, which must not overwrite saved progress. */
  onPage(page: number, record: boolean): void;
  /** A usable selection, or null when the bubble should hide. */
  onSelection(selection: PdfSelection | null): void;
}

export interface ViewerBinding {
  /** Move the viewer to `page` unless it is already there. */
  goTo(page: number): void;
  dispose(): void;
}

/**
 * Port of pdf_reader.js `bindViewer`: initial page, page tracking, sidebar closing,
 * pdf_room.css injection, selection capture and resize fitting. One `dispose` undoes it all.
 */
export function bindViewer(
  frame: HTMLIFrameElement,
  shell: HTMLElement | null,
  app: PdfApp,
  callbacks: BindCallbacks,
): ViewerBinding {
  const timers = createTimers();
  const cleanups: Array<() => void> = [];
  let disposed = false;
  let ready = false;
  let applied = false;
  let attempts = 0;
  let currentPage = 1;

  const setPage = (number: number | undefined, record = true) => {
    currentPage = clampPage(number);
    callbacks.onPage(currentPage, record);
  };
  const subscribe = (name: string, listener: PdfEventListener) => {
    app.eventBus.on(name, listener);
    cleanups.push(() => app.eventBus.off(name, listener));
  };

  subscribe('pagechanging', (event) => {
    if (ready) setPage(event.pageNumber);
  });

  const applyInitialPage = () => {
    if (applied || disposed) return;
    if (!app.pdfViewer.pagesCount && attempts++ < 80) {
      timers.later(applyInitialPage, 100);
      return;
    }
    applied = true;
    const initial = clampPage(callbacks.getInitialPage());
    app.pdfViewer.currentPageNumber = initial;
    setPage(initial, false);
    timers.later(() => {
      ready = true;
    }, 250);
  };
  subscribe('pagesinit', applyInitialPage);
  applyInitialPage();

  const closeInitialSidebar = () => {
    try {
      if (app.viewsManager?.isOpen) app.viewsManager.close();
    } catch {
      /* Older PDF.js builds may expose pdfSidebar instead. */
    }
  };
  subscribe('documentloaded', closeInitialSidebar);
  subscribe('outlineloaded', closeInitialSidebar);
  Promise.resolve(app.initializedPromise)
    .then(() => {
      if (disposed) return;
      closeInitialSidebar();
      applyInitialPage();
    })
    .catch(() => {});
  SIDEBAR_CLOSE_DELAYS_MS.forEach((delay) => timers.later(closeInitialSidebar, delay));

  const doc = frame.contentDocument;
  if (doc) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = PDF_ROOM_CSS;
    doc.head.append(link);
    cleanups.push(() => link.remove());
    const capture = () =>
      callbacks.onSelection(
        readSelection(frame, () => app.pdfViewer.currentPageNumber || currentPage),
      );
    cleanups.push(bindSelectionEvents(doc, capture, timers));
  }

  if (typeof ResizeObserver !== 'undefined') {
    let resizeTimer: ReturnType<typeof timers.later> | null = null;
    const observer = new ResizeObserver(() => {
      timers.clear(resizeTimer);
      resizeTimer = timers.later(() => {
        try {
          app.pdfViewer.update();
        } catch {
          /* PDF.js may be between documents during a resize */
        }
      }, 180);
    });
    observer.observe(shell ?? frame);
    cleanups.push(() => observer.disconnect());
  }

  return {
    goTo(page) {
      if (page && app.pdfViewer.currentPageNumber !== page) app.pdfViewer.currentPageNumber = page;
    },
    dispose() {
      disposed = true;
      timers.clearAll();
      cleanups.forEach((fn) => fn());
      cleanups.length = 0;
    },
  };
}
