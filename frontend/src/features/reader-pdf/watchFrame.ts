import { bindViewer, type BindCallbacks, type ViewerBinding } from './bindViewer';
import { readPdfApp } from './pdfApp';
import { createTimers } from './timers';

export const VIEWER_POLL_ATTEMPTS = 80;
export const VIEWER_POLL_MS = 100;

export interface WatchCallbacks extends BindCallbacks {
  /** The viewer never initialised (80 polls after load); show the native fallback. */
  onFallback(): void;
}

export interface FrameWatcher {
  goTo(page: number): void;
  dispose(): void;
}

/**
 * On each iframe `load`, poll up to 80x100ms for `PDFViewerApplication`, then bind it.
 * A repeated `load` tears the previous binding down first.
 */
export function watchPdfFrame(
  frame: HTMLIFrameElement,
  shell: HTMLElement | null,
  callbacks: WatchCallbacks,
): FrameWatcher {
  const timers = createTimers();
  let binding: ViewerBinding | null = null;

  const reset = () => {
    timers.clearAll();
    binding?.dispose();
    binding = null;
  };
  const poll = (attempt: number) => {
    const app = readPdfApp(frame);
    if (app) {
      binding = bindViewer(frame, shell, app, callbacks);
    } else if (attempt < VIEWER_POLL_ATTEMPTS) {
      timers.later(() => poll(attempt + 1), VIEWER_POLL_MS);
    } else {
      console.error('PDF.js viewer did not initialize; showing the native fallback.');
      callbacks.onFallback();
    }
  };
  const onLoad = () => {
    reset();
    poll(0);
  };
  frame.addEventListener('load', onLoad);

  return {
    goTo: (page) => binding?.goTo(page),
    dispose() {
      frame.removeEventListener('load', onLoad);
      reset();
    },
  };
}
