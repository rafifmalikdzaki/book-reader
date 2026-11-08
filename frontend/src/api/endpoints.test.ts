import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from './client';
import {
  getBook,
  getLibrary,
  notepadExportUrl,
  postMessage,
  postProgress,
  search,
} from './endpoints';
import { isBookRedirect } from './types';

const fetchMock = vi.fn<typeof fetch>();

function reply(body: unknown, status = 200): void {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  return { url: String(call[0]), init: call[1] ?? {} };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('endpoints', () => {
  it('GETs the library without a body', async () => {
    reply({ books: [], book_count: 0 });
    await getLibrary();
    const { url, init } = lastCall();
    expect(url).toBe('/api/library');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('encodes the book path and optional page as query parameters', async () => {
    reply({ redirect: 'shelf/new name.pdf' });
    const result = await getBook('sub/a b.pdf', 4);
    expect(lastCall().url).toBe('/api/book?path=sub%2Fa+b.pdf&page=4');
    expect(isBookRedirect(result)).toBe(true);

    reply({ kind: 'md', rel: 'n.md' });
    await getBook('n.md');
    expect(lastCall().url).toBe('/api/book?path=n.md');
  });

  it('POSTs progress as JSON', async () => {
    reply({ ok: true });
    await postProgress({ path: 'sub/a.pdf', page: 7 });
    const { url, init } = lastCall();
    expect(url).toBe('/api/progress');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ path: 'sub/a.pdf', page: 7 });
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('skips undefined search options and escapes the path segment of session ids', async () => {
    reply({ kind: 'library', backend: 'local', hits: [] });
    await search('needle', { limit: 20 });
    expect(lastCall().url).toBe('/api/search?q=needle&limit=20');

    reply({ session: {} });
    await postMessage('a/b', 'hello');
    const { url, init } = lastCall();
    expect(url).toBe('/api/chat/sessions/a%2Fb/messages');
    expect(JSON.parse(String(init.body))).toEqual({ content: 'hello' });
  });

  it('builds notepad export links', () => {
    expect(notepadExportUrl('markdown')).toBe('/api/notepad/export?format=markdown');
    expect(notepadExportUrl('json', 'inbox')).toBe('/api/notepad/export?format=json&group=inbox');
  });

  it('rejects with ApiError carrying the status and server detail on 404', async () => {
    reply({ detail: 'not found' }, 404);
    const error = await getBook('missing.pdf').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).detail).toBe('not found');
  });
});
