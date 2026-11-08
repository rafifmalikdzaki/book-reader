/** Test-only: fixture library, mocked endpoints and a render helper for the library page. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';

import type { LibraryBook, LibraryResponse, OrganizeStatus, SearchResponse } from '../../api/types';
import LibraryPage from './LibraryPage';

export function makeBook(overrides: Partial<LibraryBook> = {}): LibraryBook {
  return {
    rel: 'ml/Deep Learning.pdf',
    title: 'Deep Learning',
    kind: 'pdf',
    shelf: 'ml',
    category_id: 'cat-ml',
    category_name: 'Machine learning',
    page_count: 800,
    page: 12,
    percent: 40,
    thumb_url: '',
    last_read_label: '03 Nov, 09:15',
    last_read_at: null,
    updated_label: '03 Nov, 09:15',
    ...overrides,
  };
}

export const BOOKS: LibraryBook[] = [
  makeBook(),
  makeBook({
    rel: 'notes/Field Notes.md',
    title: 'Field Notes',
    kind: 'md',
    shelf: 'notes',
    category_id: 'cat-misc',
    category_name: 'Miscellaneous',
    page_count: null,
    page: null,
    percent: 0,
    last_read_label: '—',
  }),
  makeBook({
    rel: 'ml/Pattern Recognition.pdf',
    title: 'Pattern Recognition',
    category_id: 'cat-ml',
    page: null,
    percent: 0,
    page_count: 738,
    last_read_label: '—',
  }),
];

export function makeLibrary(overrides: Partial<LibraryResponse> = {}): LibraryResponse {
  return {
    books: BOOKS,
    groups: [
      { id: 'cat-ml', name: 'Machine learning', books: [BOOKS[0]!, BOOKS[2]!] },
      { id: 'cat-misc', name: 'Miscellaneous', books: [BOOKS[1]!] },
    ],
    category_options: [
      { id: 'cat-ml', name: 'Machine learning' },
      { id: 'cat-misc', name: 'Miscellaneous' },
    ],
    organize_available: true,
    organize_status: { available: true, running: false, phase: 'idle', done: 0, total: 0 },
    book_count: 3,
    resume: {
      rel: 'ml/Deep Learning.pdf',
      title: 'Deep Learning',
      kind: 'pdf',
      shelf: 'ml',
      page: 12,
      page_count: 800,
      percent: 40,
      section: 'Optimization',
      updated_label: '03 Nov, 09:15',
      updated_at: null,
    },
    resume_notes: [
      { book: 'ml/Deep Learning.pdf', page: 12, line_start: null, quote: 'Gradients vanish.', locator: 'p.12' },
      { book: 'notes/Field Notes.md', page: null, line_start: 40, quote: 'See line forty.', locator: 'L40' },
    ],
    recent: [
      {
        rel: 'ml/Pattern Recognition.pdf',
        title: 'Pattern Recognition',
        kind: 'pdf',
        shelf: 'ml',
        page: 3,
        page_count: 738,
        percent: 1,
        section: 'Intro',
        updated_label: '02 Nov, 10:00',
        updated_at: null,
      },
    ],
    relocation_notice: '',
    ...overrides,
  };
}

function Probe() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="location">{pathname + search + hash}</output>;
}

export function renderLibrary(path = '/', client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Probe />
        <LibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client: queryClient, ...result };
}

type Reply = { status: number; body: unknown };

export interface LibraryApi {
  /** "METHOD /path?query" for every request, in order. */
  calls: string[];
  /** Successive `GET /api/library` answers; the last one repeats. */
  libraries: LibraryResponse[];
  /** Successive `GET /api/organize/status` answers; the last one repeats. */
  statuses: OrganizeStatus[];
  /** When set, `GET /api/library` fails with this reply instead of answering. */
  libraryFailure: Reply | null;
  /** JSON bodies of POST requests, in order. */
  bodies: unknown[];
  /** Answer to `POST /api/organize`. */
  start: Reply;
  /** Answer to `GET /api/search`. */
  search: (q: string) => Reply;
  count: (prefix: string) => number;
}

function reply({ status, body }: Reply): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function installLibraryApi(initial: Partial<LibraryApi> = {}): LibraryApi {
  const seen = { library: 0, status: 0 };
  const api: LibraryApi = {
    calls: [],
    bodies: [],
    libraryFailure: null,
    libraries: [makeLibrary()],
    statuses: [{ available: true, running: false, phase: 'idle' }],
    start: { status: 202, body: { started: true, status: { available: true, running: true, done: 0, total: 3 } } },
    search: (): Reply => ({ status: 200, body: { kind: 'library', backend: 'local', hits: [] } satisfies SearchResponse }),
    count: (prefix) => api.calls.filter((call) => call.startsWith(prefix)).length,
    ...initial,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';
      api.calls.push(`${method} ${url.pathname}${url.search}`);
      if (typeof init?.body === 'string') api.bodies.push(JSON.parse(init.body));
      const route = `${method} ${url.pathname}`;
      if (route === 'GET /api/library') {
        if (api.libraryFailure) return reply(api.libraryFailure);
        return reply({ status: 200, body: api.libraries[Math.min(seen.library++, api.libraries.length - 1)] });
      }
      if (route === 'GET /api/organize/status') {
        return reply({ status: 200, body: api.statuses[Math.min(seen.status++, api.statuses.length - 1)] });
      }
      if (route === 'POST /api/organize') return reply(api.start);
      if (route === 'GET /api/search') return reply(api.search(url.searchParams.get('q') ?? ''));
      return reply({ status: 404, body: { detail: 'not found' } });
    }),
  );
  return api;
}
