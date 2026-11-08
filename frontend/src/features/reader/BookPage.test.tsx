import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookDetail } from '../../api/types';
import BookPage from './BookPage';

vi.mock('../reader-pdf', () => ({
  PdfReader: ({ book }: { book: BookDetail }) => <p>pdf reader: {book.title} p{book.page}</p>,
}));
vi.mock('../reader-md', () => ({
  MarkdownReader: ({ path }: { path: string }) => <p>markdown reader: {path}</p>,
}));

const requests: URL[] = [];
let respond: (url: URL) => { status: number; body: unknown };

function detail(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    kind: 'pdf',
    rel: 'sub/paper.pdf',
    title: 'A Paper',
    page: 2,
    page_count: 10,
    viewer_url: '/static/vendor/pdfjs/web/viewer.html?file=x',
    progress: { page: 2, scroll: null, updated: 1 },
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      requests.push(url);
      const { status, body } = respond(url);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function Where() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="where">{pathname + search + hash}</output>;
}

function open(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Where />
        <Routes>
          <Route path="book/*" element={<BookPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BookPage', () => {
  it('opens a PDF in the PDF reader, passes ?page= on, and sets the title', async () => {
    respond = () => ({ status: 200, body: detail({ page: 5 }) });
    open('/book/sub/paper.pdf?page=5');
    expect(await screen.findByText('pdf reader: A Paper p5')).toBeInTheDocument();
    expect(requests[0]?.searchParams.get('path')).toBe('sub/paper.pdf');
    expect(requests[0]?.searchParams.get('page')).toBe('5');
    expect(document.title).toBe('A Paper — book-reader');
  });

  it('opens Markdown in the Markdown reader and decodes the path once', async () => {
    respond = () => ({ status: 200, body: detail({ kind: 'md', rel: 'a b/c%d.md', title: 'Notes' }) });
    open('/book/a%20b/c%25d.md');
    expect(await screen.findByText('markdown reader: a b/c%d.md')).toBeInTheDocument();
    expect(requests[0]?.searchParams.get('path')).toBe('a b/c%d.md');
    expect(requests[0]?.searchParams.get('page')).toBeNull();
  });

  it('follows a redirect for a moved book, keeping the search and hash', async () => {
    respond = (url) =>
      url.searchParams.get('path') === 'old/p.pdf'
        ? { status: 200, body: { redirect: 'new dir/p.pdf' } }
        : { status: 200, body: detail({ rel: 'new dir/p.pdf', title: 'Moved' }) };
    open('/book/old/p.pdf?page=3#p3');
    expect(await screen.findByText(/pdf reader: Moved/)).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/book/new%20dir/p.pdf?page=3#p3');
  });

  it('shows the legacy not-found page with a way back', async () => {
    respond = () => ({ status: 404, body: { detail: 'Book not found' } });
    open('/book/gone.pdf');
    expect(await screen.findByRole('heading', { name: "We couldn't find that" })).toBeInTheDocument();
    expect(screen.getByText(/not in this library/)).toBeInTheDocument();
    expect(screen.getByText('404 · /book/gone.pdf')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the library' })).toHaveAttribute('href', '/');
    expect(document.title).toBe('404 — book-reader');
  });

  it('explains a path outside the library', async () => {
    respond = () => ({ status: 400, body: { detail: 'bad' } });
    open('/book/..%2Fx.pdf');
    expect(await screen.findByRole('heading', { name: "That address isn't a book" })).toBeInTheDocument();
  });

  it('shows the fallback for a PDF that cannot be opened', async () => {
    respond = () => ({ status: 200, body: detail({ error: 'The file is damaged.', viewer_url: null }) });
    open('/book/sub/paper.pdf');
    expect(await screen.findByRole('heading', { name: 'This book wouldn’t open' })).toBeInTheDocument();
    expect(screen.getByText('The file is damaged.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/pdf reader/)).not.toBeInTheDocument());
  });
});
