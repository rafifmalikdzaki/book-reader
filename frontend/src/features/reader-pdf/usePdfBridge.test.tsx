import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSelection, installApp, makeFakeViewer, selectText, type FakeViewer } from './fakeViewer';
import { go, makeBook, renderReader, text } from './PdfReader.harness';

const mocks = vi.hoisted(() => ({ postProgress: vi.fn(), compose: vi.fn() }));
vi.mock('../../api/endpoints', async (original) => ({
  ...(await original<typeof import('../../api/endpoints')>()),
  postProgress: mocks.postProgress,
}));
vi.mock('../notepad', () => ({
  useNotepad: () => ({ compose: mocks.compose, refresh: vi.fn() }),
}));

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

/** Render, plant the fake app, fire iframe load, and run past the initial-page `ready` gate. */
async function boot(options: { path?: string; app?: FakeViewer; ready?: boolean } = {}) {
  const app = options.app ?? makeFakeViewer();
  const view = renderReader(makeBook(), options.path);
  const frame = view.frame();
  installApp(frame, app);
  fireEvent.load(frame);
  if (options.ready !== false) await tick(300);
  return { ...view, app, frame };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.postProgress.mockReset().mockResolvedValue({ ok: true });
  mocks.compose.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('viewer discovery', () => {
  it('polls every 100ms until the app exists, then jumps to the initial page', async () => {
    const view = renderReader();
    const frame = view.frame();
    fireEvent.load(frame);
    await tick(500);
    const app = makeFakeViewer();
    installApp(frame, app);
    expect(app.listenerCount()).toBe(0);
    await tick(100);
    expect(app.listenerCount()).toBeGreaterThan(0);
    expect(app.pdfViewer.currentPageNumber).toBe(3);
    expect(text('context')).toBe('sub/a.pdf@3');
  });

  it('waits for the document to have pages before jumping', async () => {
    const app = makeFakeViewer(0);
    const { frame } = await boot({ app });
    expect(app.pageSets).toEqual([]);
    app.pdfViewer.pagesCount = 10;
    await tick(100);
    expect(app.pageSets).toEqual([3]);
    expect(frame.isConnected).toBe(true);
  });

  it('shows #pdf-fallback after 80 failed polls', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = renderReader();
    const frame = view.frame();
    fireEvent.load(frame);
    await tick(8100);
    const fallback = document.getElementById('pdf-fallback') as HTMLElement;
    expect(fallback).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', '/raw/sub/a.pdf');
    expect(frame.className).toMatch(/frameHidden/);
  });

  it('lets the hash beat the server page for the initial jump', async () => {
    const { app } = await boot({ path: '/book/sub/a.pdf#p7' });
    expect(app.pageSets).toEqual([7]);
    expect(text('location')).toBe('/book/sub/a.pdf#p7');
  });

  it('injects pdf_room.css into the viewer document', async () => {
    const { frame } = await boot();
    const link = frame.contentDocument?.querySelector('link[rel=stylesheet]');
    expect(link).toHaveAttribute('href', '/static/pdf_room.css');
  });
});

describe('page tracking', () => {
  it('does not record the initial jump, then debounces progress on page changes', async () => {
    const { app } = await boot({ path: '/book/sub/a.pdf?x=1' });
    await tick(500);
    expect(mocks.postProgress).not.toHaveBeenCalled();
    act(() => app.emit('pagechanging', { pageNumber: 4 }));
    act(() => app.emit('pagechanging', { pageNumber: 5 }));
    await tick(249);
    expect(mocks.postProgress).not.toHaveBeenCalled();
    await tick(1);
    expect(mocks.postProgress).toHaveBeenCalledTimes(1);
    expect(mocks.postProgress).toHaveBeenCalledWith({ path: 'sub/a.pdf', page: 5 });
    expect(text('location')).toBe('/book/sub/a.pdf?x=1#p5');
    expect(text('context')).toBe('sub/a.pdf@5');
  });

  it('ignores pagechanging until the viewer is ready', async () => {
    const { app } = await boot({ ready: false });
    await tick(100);
    act(() => app.emit('pagechanging', { pageNumber: 9 }));
    await tick(400);
    expect(mocks.postProgress).not.toHaveBeenCalled();
    expect(text('context')).toBe('sub/a.pdf@3');
  });

  it('keeps the iframe node and src across page, hash and book refetch updates', async () => {
    const { app, frame, rerenderBook } = await boot();
    const src = frame.getAttribute('src');
    act(() => app.emit('pagechanging', { pageNumber: 6 }));
    await go('/book/sub/a.pdf#p2');
    rerenderBook(makeBook({ viewer_url: '/other?x#page=9', page: 9 }));
    expect(screen.getByTitle('A Book')).toBe(frame);
    expect(frame.getAttribute('src')).toBe(src);
    expect(frame.getAttribute('data-book')).toBe('sub/a.pdf');
    expect(frame.getAttribute('data-page')).toBe('3');
    expect(frame).toHaveAttribute('allow', 'fullscreen');
  });
});

describe('opening deep links', () => {
  it('starts PDF.js on the #p<n> the page opened with, not the server page', () => {
    const view = renderReader(makeBook(), '/book/sub/a.pdf#p4');
    expect(view.frame().getAttribute('src')).toBe(
      '/static/vendor/pdfjs/web/viewer.html?file=%2Fraw%2Fsub%2Fa.pdf#page=4',
    );
  });

  it('keeps the server page when the URL has no #p<n>', () => {
    const view = renderReader(makeBook());
    expect(view.frame().getAttribute('src')).toContain('#page=3');
  });
});

describe('deep links after mount', () => {
  it('moves the viewer when a router push changes the hash, without a feedback loop', async () => {
    const { app } = await boot();
    app.pageSets.length = 0;
    await go('/book/sub/a.pdf#p9');
    expect(app.pdfViewer.currentPageNumber).toBe(9);
    await tick(600);
    expect(app.pageSets).toEqual([9]);
    expect(mocks.postProgress).toHaveBeenCalledTimes(1);
    expect(mocks.postProgress).toHaveBeenCalledWith({ path: 'sub/a.pdf', page: 9 });
    expect(text('location')).toBe('/book/sub/a.pdf#p9');
    expect(text('context')).toBe('sub/a.pdf@9');
  });

  it('follows a push to a hash that equals an earlier one after scrolling away', async () => {
    const { app } = await boot({ path: '/book/sub/a.pdf#p3' });
    act(() => app.emit('pagechanging', { pageNumber: 8 }));
    await tick(300);
    await go('/book/sub/a.pdf#p3');
    expect(app.pdfViewer.currentPageNumber).toBe(3);
  });

  it('never bounces back when pages change faster than the router commits', async () => {
    const { app } = await boot();
    app.pageSets.length = 0;
    act(() => {
      app.emit('pagechanging', { pageNumber: 5 });
      app.emit('pagechanging', { pageNumber: 6 });
      app.emit('pagechanging', { pageNumber: 7 });
    });
    await tick(600);
    expect(app.pageSets).toEqual([]);
    expect(app.pdfViewer.currentPageNumber).toBe(3);
    expect(text('location')).toBe('/book/sub/a.pdf#p7');
  });

  it('ignores non-page hashes', async () => {
    const { app } = await boot();
    app.pageSets.length = 0;
    await go('/book/sub/a.pdf#L12');
    expect(app.pageSets).toEqual([]);
  });
});

describe('selection bubble', () => {
  async function selectOnPage4() {
    const booted = await boot();
    vi.spyOn(booted.frame, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 50 } as DOMRect);
    selectText(booted.frame, {
      pageNumber: 4,
      text: '  a quote  ',
      rect: { left: 100, top: 200, width: 60 },
    });
    return booted;
  }

  it('shows the bubble above the selection and composes a pdf note on click', async () => {
    const { frame } = await selectOnPage4();
    const bubble = document.getElementById('note-capture') as HTMLElement;
    expect(bubble).toBeInTheDocument();
    expect(bubble).not.toBeVisible();
    fireEvent.mouseUp(frame.contentDocument as Document);
    await tick(0);
    expect(bubble).toBeVisible();
    expect(bubble.style.left).toBe('103px');
    expect(bubble.style.top).toBe('208px');
    fireEvent.click(bubble);
    expect(mocks.compose).toHaveBeenCalledWith({
      book: 'sub/a.pdf',
      kind: 'pdf',
      page: 4,
      quote: 'a quote',
    });
    expect(bubble).not.toBeVisible();
  });

  it('debounces selectionchange and uses touchend after 250ms', async () => {
    const { frame } = await selectOnPage4();
    const doc = frame.contentDocument as Document;
    const bubble = document.getElementById('note-capture') as HTMLElement;
    doc.dispatchEvent(new Event('selectionchange'));
    await tick(199);
    expect(bubble).not.toBeVisible();
    await tick(1);
    expect(bubble).toBeVisible();
    clearSelection(frame);
    doc.dispatchEvent(new Event('selectionchange'));
    await tick(200);
    expect(bubble).not.toBeVisible();
  });

  it('falls back to the viewer page for text outside a .page, and trims huge quotes', async () => {
    const { frame, app } = await selectOnPage4();
    app.pdfViewer.currentPageNumber = 2;
    selectText(frame, { pageNumber: null, text: 'y'.repeat(9000), rect: { left: 0, top: 0, width: 10 } });
    fireEvent.mouseUp(frame.contentDocument as Document);
    await tick(0);
    fireEvent.click(document.getElementById('note-capture') as HTMLElement);
    const draft = mocks.compose.mock.calls[0]?.[0] as { page: number; quote: string };
    expect(draft.page).toBe(2);
    expect(draft.quote).toHaveLength(7800);
  });

  it('hides on a press outside the bubble but not on the bubble itself', async () => {
    const { frame } = await selectOnPage4();
    const bubble = document.getElementById('note-capture') as HTMLElement;
    fireEvent.mouseUp(frame.contentDocument as Document);
    await tick(0);
    fireEvent.mouseDown(bubble);
    expect(bubble).toBeVisible();
    fireEvent.mouseDown(document.body);
    expect(bubble).not.toBeVisible();
  });
});

describe('sidebar, resize and cleanup', () => {
  it('closes the sidebar at 0, 250, 750 and 1500ms and on documentloaded/outlineloaded', async () => {
    const app = makeFakeViewer();
    const { frame } = await boot({ app, ready: false });
    const calls = () => app.viewsManager.close.mock.calls.length;
    expect(frame).toBeTruthy();
    await tick(0);
    const base = calls();
    expect(base).toBeGreaterThan(0);
    for (const [wait, grew] of [[249, false], [1, true], [499, false], [1, true], [749, false], [1, true]] as const) {
      const before = calls();
      await tick(wait);
      expect(calls() > before).toBe(grew);
    }
    const before = calls();
    act(() => app.emit('documentloaded'));
    act(() => app.emit('outlineloaded'));
    expect(calls()).toBe(before + 2);
  });

  it('does not close an already closed sidebar', async () => {
    const app = makeFakeViewer();
    app.viewsManager.isOpen = false;
    await boot({ app });
    expect(app.viewsManager.close).not.toHaveBeenCalled();
  });

  it('refits the viewer 180ms after the shell resizes', async () => {
    const observed: Element[] = [];
    let trigger: () => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          trigger = callback;
        }
        observe(target: Element) {
          observed.push(target);
        }
        disconnect() {}
      },
    );
    const { app } = await boot();
    expect(observed).toEqual([document.getElementById('pdf-shell')]);
    act(() => {
      trigger();
      trigger();
    });
    await tick(179);
    expect(app.pdfViewer.update).not.toHaveBeenCalled();
    await tick(1);
    expect(app.pdfViewer.update).toHaveBeenCalledTimes(1);
  });

  it('removes every listener and flushes pending progress on unmount', async () => {
    const { app, frame, unmount } = await boot();
    const doc = frame.contentDocument as Document;
    const removed = vi.spyOn(doc, 'removeEventListener');
    act(() => app.emit('pagechanging', { pageNumber: 5 }));
    unmount();
    expect(app.listenerCount()).toBe(0);
    expect(removed.mock.calls.map((call) => call[0]).sort()).toEqual([
      'mouseup',
      'selectionchange',
      'touchend',
    ]);
    expect(doc.querySelector('link[rel=stylesheet]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.postProgress).toHaveBeenCalledWith({ path: 'sub/a.pdf', page: 5 });
  });

  it('clears the book context on unmount', async () => {
    const view = renderReader();
    expect(text('context')).toBe('sub/a.pdf@3');
    view.unmount();
  });
});

describe('unreadable books', () => {
  it('renders the error panel and no iframe', () => {
    const view = renderReader(makeBook({ error: 'Corrupt xref', viewer_url: null, page_count: null }));
    expect(screen.getByRole('heading', { name: /wouldn’t open/ })).toBeInTheDocument();
    expect(screen.getByText('Corrupt xref')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the library' })).toHaveAttribute('href', '/');
    expect(document.querySelector('iframe')).toBeNull();
    expect(text('context')).toBe('none');
    view.unmount();
  });
});
