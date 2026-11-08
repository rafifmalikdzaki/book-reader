/** Test-only: a Markdown book served by a stubbed fetch, rendered inside the real shell. */
import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';

import { installFakeApi } from '../../app/fakeApi';
import { renderShell } from '../../app/testing';
import { useBookContext } from '../../app';
import type { MarkdownResponse } from '../../api/types';
import { MarkdownReader } from './MarkdownReader';

export const HTML = [
  '<h1 id="L1">Title</h1>',
  '<p id="L3">First paragraph with <a href="/book/other.md#L9">a book link</a>, ' +
    '<a href="/raw/pic.png">a raw link</a> and <a href="https://example.com/x">an outside link</a>.</p>',
  '<h2 id="L5">Methods</h2>',
  '<p id="L7">Second paragraph text.</p>',
  '<h2 id="L9">Results</h2>',
  '<p id="L11">Third paragraph.</p>',
].join('');

export function makeDoc(overrides: Partial<MarkdownResponse> = {}): MarkdownResponse {
  return {
    kind: 'md',
    rel: 'notes/n.md',
    title: 'Title',
    html: HTML,
    outline: [
      { level: 1, title: 'Title', line: 1 },
      { level: 2, title: 'Methods', line: 5 },
      { level: 2, title: 'Results', line: 9 },
    ],
    progress: { page: null, scroll: null, updated: null },
    error: null,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export interface PostedProgress {
  path: string;
  scroll: number;
}

/** Serves `/api/book/markdown` (any path) and records `/api/progress` POSTs. */
export function serveMarkdown(doc: MarkdownResponse): { posts: PostedProgress[] } {
  installFakeApi();
  const fallback = globalThis.fetch;
  const posts: PostedProgress[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/book/markdown') return json({ ...doc, rel: url.searchParams.get('path') });
      if (url.pathname === '/api/progress' && init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)) as PostedProgress);
        return json({ ok: true });
      }
      return fallback(input, init);
    }),
  );
  return { posts };
}

function Reader() {
  return <MarkdownReader path={useParams()['*'] ?? ''} />;
}

function Probes() {
  const navigate = useNavigate();
  const { book } = useBookContext();
  return (
    <>
      <output data-testid="book-context">{book ?? 'none'}</output>
      <button type="button" onClick={() => void navigate('/book/notes/n.md#L9')}>
        go to line 9
      </button>
    </>
  );
}

export async function openMarkdown(path = '/book/notes/n.md') {
  const view = renderShell(
    path,
    <>
      <Probes />
      <Routes>
        <Route path="book/*" element={<Reader />} />
      </Routes>
    </>,
  );
  await screen.findByRole('heading', { name: 'Title' });
  return view;
}

/** jsdom has no layout: fake the scroll geometry the reader measures. */
export function stubScroll(scrollHeight: number, viewport = 1000): { scrollTo: (y: number) => void } {
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport });
  let y = 0;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
  return {
    scrollTo(next) {
      y = next;
      window.dispatchEvent(new Event('scroll'));
    },
  };
}
