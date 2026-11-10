import { act, fireEvent, screen } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { go, makeBook, renderReader, text } from './PdfReader.harness';
import type { PdfDocumentLike, PdfPageLike } from './pdfCore';

const mocks = vi.hoisted(() => ({
  postProgress: vi.fn(),
  compose: vi.fn(),
  shouldFailLoad: false,
  customDoc: null as PdfDocumentLike | null,
}));

vi.mock('../../api/endpoints', async (original) => ({
  ...(await original<typeof import('../../api/endpoints')>()),
  postProgress: mocks.postProgress,
}));

vi.mock('../notepad', () => ({
  useNotepad: () => ({ compose: mocks.compose, refresh: vi.fn() }),
}));

function makeFakePdfDoc(numPages = 10): PdfDocumentLike {
  return {
    numPages,
    getOutline: async () => [
      {
        title: 'Chapter 1: Foundations',
        dest: [{ num: 1, gen: 0 }],
        items: [{ title: '1.1 Preliminaries', dest: [{ num: 2, gen: 0 }] }],
      },
      {
        title: 'Chapter 2: Stochastic Calculus',
        dest: 'chap2',
      },
    ],
    getDestination: async (dest: string) => (dest === 'chap2' ? [{ num: 6, gen: 0 }] : null),
    getPageIndex: async (ref: unknown) => {
      const r = ref as { num?: number };
      return (r.num ?? 1) - 1;
    },
    getPage: async (pageNumber: number): Promise<PdfPageLike> => ({
      pageNumber,
      originalWidth: 612,
      originalHeight: 792,
      getTextContent: async () => ({
        items: [
          {
            str:
              pageNumber === 4 || pageNumber === 8
                ? `Page ${pageNumber} discusses martingale convergence in detail.`
                : `Page ${pageNumber} general text.`,
          },
        ],
      }),
    }),
  };
}

vi.mock('react-pdf', () => {
  function MockDocument({
    file,
    rotate,
    onLoadSuccess,
    onLoadError,
    children,
  }: {
    file: string;
    rotate?: number;
    onLoadSuccess?: (doc: PdfDocumentLike) => void;
    onLoadError?: (err: Error) => void;
    children?: ReactNode;
  }) {
    useEffect(() => {
      if (mocks.shouldFailLoad) {
        onLoadError?.(new Error('Failed to parse PDF'));
      } else {
        onLoadSuccess?.(mocks.customDoc ?? makeFakePdfDoc(10));
      }
    }, [file, onLoadError, onLoadSuccess]);

    return (
      <div data-testid="react-pdf-document" data-file={file} data-rotate={rotate ?? 0}>
        {children}
      </div>
    );
  }

  function MockPage({
    pageNumber,
    width,
    rotate,
    customTextRenderer,
    onLoadSuccess,
  }: {
    pageNumber: number;
    width?: number;
    rotate?: number;
    customTextRenderer?: (args: { str: string; itemIndex: number }) => string;
    onLoadSuccess?: (page: PdfPageLike) => void;
  }) {
    useEffect(() => {
      onLoadSuccess?.({ pageNumber, originalWidth: 612, originalHeight: 792 });
    }, [onLoadSuccess, pageNumber]);

    const sample = `Sample text on page ${pageNumber} with martingale term`;
    const renderedHtml = customTextRenderer
      ? customTextRenderer({ str: sample, itemIndex: 0 })
      : sample;

    return (
      <div
        data-testid={`rendered-pdf-page-${pageNumber}`}
        data-width={width}
        data-rotate={rotate ?? 0}
        className="react-pdf__Page"
      >
        <div
          className="react-pdf__Page__textContent"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      </div>
    );
  }

  return {
    Document: MockDocument,
    Page: MockPage,
    pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
  };
});

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

function installSelection(options: {
  pageNumber: number | null;
  text: string;
  rect: { left: number; top: number; width: number };
}) {
  const container = document.getElementById('pdf-viewer-container') as HTMLElement;
  let targetNode: Node = container;
  if (options.pageNumber !== null) {
    const slot = container.querySelector(
      `.page[data-page-number="${options.pageNumber}"]`,
    ) as HTMLElement;
    const span = document.createElement('span');
    span.textContent = options.text;
    slot.appendChild(span);
    targetNode = span.firstChild ?? span;
  }

  const fakeRange = {
    commonAncestorContainer: targetNode,
    getBoundingClientRect: () => ({
      left: options.rect.left,
      top: options.rect.top,
      width: options.rect.width,
      height: 18,
      right: options.rect.left + options.rect.width,
      bottom: options.rect.top + 18,
      x: options.rect.left,
      y: options.rect.top,
      toJSON: () => ({}),
    }),
  } as unknown as Range;

  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: !options.text,
    rangeCount: options.text ? 1 : 0,
    getRangeAt: () => fakeRange,
    toString: () => options.text,
  } as unknown as Selection);
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.postProgress.mockReset().mockResolvedValue({ ok: true });
  mocks.compose.mockReset();
  mocks.shouldFailLoad = false;
  mocks.customDoc = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('document initialization & windowed rendering', () => {
  it('opens on the server page by default and windows rendered <Page> canvases', async () => {
    renderReader(makeBook({ page: 5, page_count: 10 }));
    await tick(10);

    expect(text('context')).toBe('sub/a.pdf@5');
    expect(screen.getByTestId('react-pdf-document')).toHaveAttribute('data-file', '/raw/sub/a.pdf');

    // Pages 3..7 (5 ± 2) render active <Page> components; distant pages stay lightweight placeholders
    expect(screen.getByTestId('rendered-pdf-page-3')).toBeInTheDocument();
    expect(screen.getByTestId('rendered-pdf-page-5')).toBeInTheDocument();
    expect(screen.getByTestId('rendered-pdf-page-7')).toBeInTheDocument();
    expect(screen.queryByTestId('rendered-pdf-page-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rendered-pdf-page-10')).not.toBeInTheDocument();
  });

  it('lets a #p<n> deep link beat the server page on initial mount', async () => {
    renderReader(makeBook({ page: 3, page_count: 10 }), '/book/sub/a.pdf#p8');
    await tick(10);

    expect(text('context')).toBe('sub/a.pdf@8');
    expect(text('location')).toBe('/book/sub/a.pdf#p8');
    expect(screen.getByTestId('rendered-pdf-page-8')).toBeInTheDocument();
  });

  it('shows #pdf-fallback when the PDF document fails to load', async () => {
    mocks.shouldFailLoad = true;
    renderReader();
    await tick(10);

    const fallback = document.getElementById('pdf-fallback') as HTMLElement;
    expect(fallback).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', '/raw/sub/a.pdf');
  });
});

describe('toolbar navigation, zoom, and rotation', () => {
  it('navigates pages via Next/Previous buttons and direct page input, debouncing progress', async () => {
    renderReader(makeBook({ page: 3, page_count: 10 }), '/book/sub/a.pdf?x=1');
    await tick(50);
    expect(mocks.postProgress).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(text('context')).toBe('sub/a.pdf@5');
    expect(text('location')).toBe('/book/sub/a.pdf?x=1#p5');

    await tick(249);
    expect(mocks.postProgress).not.toHaveBeenCalled();
    await tick(1);
    expect(mocks.postProgress).toHaveBeenCalledTimes(1);
    expect(mocks.postProgress).toHaveBeenCalledWith({ path: 'sub/a.pdf', page: 5 });

    // Direct page input jump
    const input = screen.getByRole('textbox', { name: 'Page number' });
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.submit(input.closest('form')!);
    await tick(250);
    expect(text('context')).toBe('sub/a.pdf@9');
    expect(mocks.postProgress).toHaveBeenLastCalledWith({ path: 'sub/a.pdf', page: 9 });
  });

  it('supports zoom presets, step zoom buttons, and clockwise rotation', async () => {
    renderReader();
    await tick(10);

    const zoomSelect = screen.getByRole('combobox', { name: 'Zoom level' });
    fireEvent.change(zoomSelect, { target: { value: '1.5' } });
    expect(screen.getByTestId('rendered-pdf-page-3')).toHaveAttribute('data-width', '918');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByTestId('rendered-pdf-page-3')).toHaveAttribute('data-width', '1224');

    fireEvent.click(screen.getByRole('button', { name: 'Rotate clockwise' }));
    expect(screen.getByTestId('react-pdf-document')).toHaveAttribute('data-rotate', '90');
  });
});

describe('two-page view', () => {
  afterEach(() => window.localStorage.removeItem('book-reader.pdf-spread'));

  it('lays facing pages side by side at half width and remembers the choice', async () => {
    renderReader();
    await tick(10);
    const single = Number(screen.getAllByTestId(/^rendered-pdf-page-/)[0]?.dataset.width);
    expect(document.querySelector('[data-spread-row]')).toBeNull();

    const toggle = screen.getByRole('button', { name: 'Two-page view' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const rows = document.querySelectorAll('[data-spread-row]');
    expect(rows[0]?.querySelectorAll('.page')).toHaveLength(1);
    expect(rows[1]?.querySelectorAll('.page')).toHaveLength(2);
    const facing = Number(screen.getAllByTestId(/^rendered-pdf-page-/)[0]?.dataset.width);
    expect(facing).toBe(Math.round(single / 2));
    expect(window.localStorage.getItem('book-reader.pdf-spread')).toBe('1');

    fireEvent.click(toggle);
    expect(document.querySelector('[data-spread-row]')).toBeNull();
  });
});

describe('contents rail (outline & page thumbnails)', () => {
  it('extracts the PDF outline and jumps to chapters or page thumbnails on click', async () => {
    renderReader(makeBook({ page: 1, page_count: 10 }));
    await tick(20);

    fireEvent.click(screen.getByRole('button', { name: 'Contents' }));
    expect(screen.getByText('Chapter 1: Foundations')).toBeInTheDocument();
    expect(screen.getByText('1.1 Preliminaries')).toBeInTheDocument();
    expect(screen.getByText('Chapter 2: Stochastic Calculus')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Chapter 2: Stochastic Calculus'));
    await tick(250);
    expect(text('context')).toBe('sub/a.pdf@6');
    expect(mocks.postProgress).toHaveBeenLastCalledWith({ path: 'sub/a.pdf', page: 6 });

    // Switch to Pages (thumbnails) tab
    fireEvent.click(screen.getByRole('tab', { name: /Pages \(10\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 4' }));
    await tick(250);
    expect(text('context')).toBe('sub/a.pdf@4');
  });
});

describe('in-document search & highlighting', () => {
  it('searches across document pages, steps through matches, and highlights text', async () => {
    renderReader(makeBook({ page: 1, page_count: 10 }));
    await tick(20);

    fireEvent.click(screen.getByRole('button', { name: 'Find in PDF' }));
    const searchInput = screen.getByRole('searchbox', { name: 'Find in document' });
    fireEvent.change(searchInput, { target: { value: 'martingale' } });
    await tick(50);

    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(text('context')).toBe('sub/a.pdf@4');

    // Verify <mark> highlight rendered inside page 4's text layer
    const page4 = screen.getByTestId('rendered-pdf-page-4');
    expect(page4.querySelector('mark')?.textContent).toBe('martingale');

    // Step to next match (page 8)
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    await tick(20);
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    expect(text('context')).toBe('sub/a.pdf@8');

    fireEvent.click(screen.getByRole('button', { name: 'Close find bar' }));
    expect(screen.queryByRole('searchbox', { name: 'Find in document' })).not.toBeInTheDocument();
  });
});

describe('deep links after mount & cleanup', () => {
  it('moves the viewer when a router push changes the hash, without a feedback loop', async () => {
    renderReader();
    await tick(20);

    await go('/book/sub/a.pdf#p9');
    await tick(250);
    expect(text('context')).toBe('sub/a.pdf@9');
    expect(text('location')).toBe('/book/sub/a.pdf#p9');
    expect(mocks.postProgress).toHaveBeenCalledWith({ path: 'sub/a.pdf', page: 9 });
  });

  it('flushes pending progress and clears book context on unmount', async () => {
    const view = renderReader();
    await tick(20);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    view.unmount();
    expect(mocks.postProgress).toHaveBeenCalledWith({ path: 'sub/a.pdf', page: 4 });
  });
});

describe('selection bubble', () => {
  it('shows the bubble above the selection and composes a pdf note on click', async () => {
    renderReader(makeBook({ page: 4, page_count: 10 }));
    await tick(20);

    installSelection({
      pageNumber: 4,
      text: '  a quote from page 4  ',
      rect: { left: 110, top: 250, width: 60 },
    });

    const bubble = document.getElementById('note-capture') as HTMLElement;
    expect(bubble).not.toBeVisible();

    fireEvent.mouseUp(document);
    await tick(0);
    expect(bubble).toBeVisible();
    expect(bubble.style.left).toBe('103px');
    expect(bubble.style.top).toBe('208px');

    fireEvent.click(bubble);
    expect(mocks.compose).toHaveBeenCalledWith({
      book: 'sub/a.pdf',
      kind: 'pdf',
      page: 4,
      quote: 'a quote from page 4',
    });
    expect(bubble).not.toBeVisible();
  });

  it('falls back to current page when selection is outside a .page and trims huge quotes', async () => {
    renderReader(makeBook({ page: 2, page_count: 10 }));
    await tick(20);

    installSelection({
      pageNumber: null,
      text: 'y'.repeat(9000),
      rect: { left: 20, top: 80, width: 20 },
    });
    fireEvent.mouseUp(document);
    await tick(0);
    fireEvent.click(document.getElementById('note-capture') as HTMLElement);

    const draft = mocks.compose.mock.calls[0]?.[0] as { page: number; quote: string };
    expect(draft.page).toBe(2);
    expect(draft.quote).toHaveLength(7800);
  });

  it('hides on a press outside the bubble', async () => {
    renderReader(makeBook({ page: 4, page_count: 10 }));
    await tick(20);

    installSelection({
      pageNumber: 4,
      text: 'selected text',
      rect: { left: 100, top: 200, width: 40 },
    });
    fireEvent.mouseUp(document);
    await tick(0);

    const bubble = document.getElementById('note-capture') as HTMLElement;
    expect(bubble).toBeVisible();
    fireEvent.mouseDown(document.body);
    expect(bubble).not.toBeVisible();
  });
});

describe('unreadable books', () => {
  it('renders the error panel when book has an error', () => {
    const view = renderReader(makeBook({ error: 'Corrupt xref', viewer_url: null, page_count: null }));
    expect(screen.getByRole('heading', { name: /wouldn’t open/ })).toBeInTheDocument();
    expect(screen.getByText('Corrupt xref')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the library' })).toHaveAttribute('href', '/');
    expect(text('context')).toBe('none');
    view.unmount();
  });
});
