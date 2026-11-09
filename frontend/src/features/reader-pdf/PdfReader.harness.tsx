/** Test-only: renders PdfReader inside the real book-context, panel, and stage providers. */
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

import type { BookDetail } from '../../api/types';
import { BookContextProvider, useBookContext } from '../../app';
import { ShellChromeProvider, useChromeState } from '../../app/ShellChrome';
import { PanelProvider } from '../../ui';
import { PdfReader } from './PdfReader';

export function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    kind: 'pdf',
    rel: 'sub/a.pdf',
    title: 'A Book',
    page: 3,
    page_count: 10,
    viewer_url: '/static/vendor/pdfjs/web/viewer.html?file=%2Fraw%2Fsub%2Fa.pdf#page=3',
    progress: { page: 3, scroll: null },
    error: null,
    ...overrides,
  } as BookDetail;
}

export const nav: { go: (to: string) => void } = { go: () => {} };

function Probes() {
  const { pathname, search, hash } = useLocation();
  const { book, page } = useBookContext();
  const { setContentsHost } = useChromeState();
  const navigate = useNavigate();
  useEffect(() => {
    nav.go = (to) => navigate(to);
  }, [navigate]);
  return (
    <>
      <output data-testid="location">{pathname + search + hash}</output>
      <output data-testid="context">{book ? `${book}@${page}` : 'none'}</output>
      <div ref={setContentsHost} data-testid="contents-host" />
    </>
  );
}

export function renderReader(book: BookDetail = makeBook(), path = '/book/sub/a.pdf') {
  const tree = (b: BookDetail) => (
    <MemoryRouter initialEntries={[path]}>
      <PanelProvider>
        <BookContextProvider>
          <ShellChromeProvider>
            <Probes />
            <PdfReader book={b} />
          </ShellChromeProvider>
        </BookContextProvider>
      </PanelProvider>
    </MemoryRouter>
  );
  const view = render(tree(book));
  const shell = () => document.getElementById('pdf-shell') as HTMLElement;
  const container = () => document.getElementById('pdf-viewer-container') as HTMLElement;
  return { ...view, shell, container, rerenderBook: (b: BookDetail) => view.rerender(tree(b)) };
}

export const text = (id: string) => screen.getByTestId(id).textContent;
export const go = (to: string) => act(() => nav.go(to));
