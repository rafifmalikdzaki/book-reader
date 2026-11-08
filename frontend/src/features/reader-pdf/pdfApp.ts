/**
 * The slice of PDF.js's `PDFViewerApplication` that the bridge touches. The viewer is a
 * same-origin iframe, so the bridge reaches `frame.contentWindow.PDFViewerApplication`
 * directly (no postMessage). Kept minimal on purpose: only what pdf_reader.js used.
 */
export interface PdfEvent {
  pageNumber?: number;
}

export type PdfEventListener = (event: PdfEvent) => void;

export interface PdfEventBus {
  on(name: string, listener: PdfEventListener): void;
  off(name: string, listener: PdfEventListener): void;
}

export interface PdfViewerLike {
  currentPageNumber: number;
  readonly pagesCount: number;
  update(): void;
}

export interface PdfViewsManager {
  readonly isOpen: boolean;
  close(): void;
}

export interface PdfApp {
  eventBus: PdfEventBus;
  pdfViewer: PdfViewerLike;
  /** Absent on older PDF.js builds. */
  viewsManager?: PdfViewsManager;
  initializedPromise?: Promise<unknown>;
}

/** The iframe window before and after the viewer has initialised. */
export type PdfFrameWindow = Window & { PDFViewerApplication?: Partial<PdfApp> };

/** The app once it has a viewer and an event bus, else null (legacy `waitForViewer` check). */
export function readPdfApp(frame: HTMLIFrameElement): PdfApp | null {
  const app = (frame.contentWindow as PdfFrameWindow | null)?.PDFViewerApplication;
  return app?.pdfViewer && app.eventBus ? (app as PdfApp) : null;
}
