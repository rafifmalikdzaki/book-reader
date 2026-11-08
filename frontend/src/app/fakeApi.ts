/** Test-only: an in-memory stand-in for the notepad, chat-options and reindex endpoints. */
import { vi } from 'vitest';

import type { ChatModelOption, NotepadGroup, NotepadNote } from '../api/types';

export interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

export interface FakeApi {
  calls: Call[];
  groups: NotepadGroup[];
  notes: NotepadNote[];
  models: ChatModelOption[];
  selected: string;
  reindexNotice: string;
  /** "METHOD /path" -> error response served instead of the normal handler. */
  fail: Record<string, { status: number; detail: string }>;
}

export function makeNote(overrides: Partial<NotepadNote> = {}): NotepadNote {
  return {
    id: 'n1',
    group: 'inbox',
    book: 'sub/paper.pdf',
    kind: 'pdf',
    quote: 'A sentence worth keeping.',
    page: 12,
    section: '',
    char_start: null,
    char_end: null,
    line_start: null,
    line_end: null,
    paragraph: null,
    comment: '',
    created: 1,
    updated: 1,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function installFakeApi(initial: Partial<FakeApi> = {}): FakeApi {
  const api: FakeApi = {
    calls: [],
    groups: [{ id: 'inbox', name: 'Inbox', created: 0 }],
    notes: [],
    models: [{ id: 'mistral:small', provider: 'mistral', model: 'small' }],
    selected: 'auto',
    reindexNotice: '',
    fail: {},
    ...initial,
  };
  let counter = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      api.calls.push({ method, path: url.pathname, body });
      const parts = url.pathname.split('/');
      const id = decodeURIComponent(parts[4] ?? '');
      const failure = api.fail[`${method} ${url.pathname}`];
      if (failure) return json({ detail: failure.detail }, failure.status);

      if (url.pathname === '/api/notepad' && method === 'GET') {
        return json({ groups: api.groups, notes: api.notes });
      }
      if (url.pathname === '/api/notepad/groups' && method === 'POST') {
        const group = { id: `g${++counter}`, name: String(body?.name), created: 2 };
        api.groups.push(group);
        return json(group);
      }
      if (parts[3] === 'groups' && method === 'DELETE') {
        const before = api.notes.length;
        api.notes = api.notes.filter((note) => note.group !== id);
        api.groups = api.groups.filter((group) => group.id !== id);
        return json({ removed_notes: before - api.notes.length });
      }
      if (url.pathname === '/api/notepad/notes' && method === 'POST') {
        const note = makeNote({ id: `n${++counter + 100}`, ...(body as Partial<NotepadNote>) });
        if (!note.group) note.group = 'inbox';
        api.notes.push(note);
        return json(note);
      }
      if (parts[3] === 'notes' && method === 'PATCH') {
        const note = api.notes.find((item) => item.id === id);
        if (!note) return json({ detail: 'missing' }, 404);
        Object.assign(note, body);
        return json(note);
      }
      if (parts[3] === 'notes' && method === 'DELETE') {
        api.notes = api.notes.filter((note) => note.id !== id);
        return json({ ok: true });
      }
      if (url.pathname === '/api/chat/options' && method === 'GET') {
        return json({ available: true, models: api.models, selected: api.selected });
      }
      if (url.pathname === '/api/chat/options' && method === 'POST') {
        api.selected = String(body?.model);
        return json({ ok: true, selected: api.selected });
      }
      if (url.pathname === '/api/library/reindex' && method === 'POST') {
        return json({ moved: {}, conflicts: [], added: 0, missing: 0, hashed: 0, backed_up: null, failed: [], recovered: false, notice: api.reindexNotice });
      }
      return json({ detail: 'not found' }, 404);
    }),
  );
  return api;
}
