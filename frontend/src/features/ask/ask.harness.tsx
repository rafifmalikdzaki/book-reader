/** Test-only: a stateful fake of the chat-session endpoints plus a router/query wrapper. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';

import { ApiError } from '../../api/client';
import * as endpoints from '../../api/endpoints';
import type { CategoryRecord, ChatProject, ChatSession, ChatStatus } from '../../api/types';
import AskPage from './AskPage';

export interface Server {
  sessions: ChatSession[];
  projects: ChatProject[];
  categories: CategoryRecord[];
  status: ChatStatus;
  /** Resolves a posted message; swap in a deferred promise to observe the pending state. */
  answer: (content: string) => Promise<{ text: string; book: string; page: number }>;
  counter: number;
}

export function makeSession(over: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 's0',
    title: 'Tensors',
    created: 1,
    updated: Date.now() / 1000,
    pinned: false,
    project_id: null,
    book: null,
    page: null,
    categories: [],
    messages: [],
    ...over,
  };
}

const copy = <T,>(value: T): T => structuredClone(value);
const gone = () => new ApiError(404, 'Chat not found');

export function installServer(over: Partial<Server> = {}): Server {
  const server: Server = {
    sessions: [],
    projects: [],
    categories: [
      { id: 'c1', name: 'Papers', description: '' },
      { id: 'c2', name: 'Textbooks', description: '' },
    ],
    status: { available: true, providers: [], selected: 'auto' },
    answer: async () => ({ text: 'A tensor is an array.', book: 'shelf/ML.pdf', page: 3 }),
    counter: 0,
    ...over,
  };
  const find = (id: string) => {
    const found = server.sessions.find((item) => item.id === id);
    if (!found) throw gone();
    return found;
  };
  vi.mocked(endpoints.listChatSessions).mockImplementation(async () =>
    copy({
      retention_days: 7,
      categories: server.categories,
      projects: server.projects,
      sessions: server.sessions,
    }),
  );
  vi.mocked(endpoints.getChatStatus).mockImplementation(async () => copy(server.status));
  vi.mocked(endpoints.getChatOptions).mockImplementation(async () => ({
    available: true,
    models: [{ id: 'inception:mercury-3', provider: 'inception', model: 'mercury-3' }],
    selected: 'auto',
    effort: 'default',
  }));
  vi.mocked(endpoints.getChatSession).mockImplementation(async (id) => copy(find(id)));
  vi.mocked(endpoints.createChatSession).mockImplementation(async (body = {}) => {
    const created = makeSession({
      id: `s${++server.counter}`,
      title: 'New chat',
      book: body.book ?? null,
      page: body.page ?? null,
      categories: body.categories ?? [],
    });
    server.sessions.unshift(created);
    return copy(created);
  });
  vi.mocked(endpoints.updateChatSession).mockImplementation(async (id, patch) => {
    const target = find(id);
    Object.assign(target, patch);
    return copy(target);
  });
  vi.mocked(endpoints.deleteChatSession).mockImplementation(async (id) => {
    find(id);
    server.sessions = server.sessions.filter((item) => item.id !== id);
    return { ok: true };
  });
  vi.mocked(endpoints.postMessage).mockImplementation(async (id, content) => {
    const target = find(id);
    const reply = await server.answer(content);
    const base = { provider: 'mistral', model: 'small', created: 1 };
    target.title = content;
    target.messages.push(
      { id: `u${target.messages.length}`, role: 'user', content, sources: [], ...base },
      {
        id: `a${target.messages.length}`,
        role: 'assistant',
        content: reply.text,
        sources: [{ book: reply.book, page: reply.page }],
        ...base,
      },
    );
    return { session: copy(target) };
  });
  vi.mocked(endpoints.createChatProject).mockImplementation(async (name) => {
    const project = { id: `p${++server.counter}`, name, created: 1 };
    server.projects.push(project);
    return project;
  });
  vi.mocked(endpoints.deleteChatProject).mockImplementation(async (id) => {
    server.projects = server.projects.filter((item) => item.id !== id);
    for (const item of server.sessions) if (item.project_id === id) item.project_id = null;
    return { ok: true };
  });
  return server;
}

function Probe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
}

export function renderAsk(path: string | { pathname: string; state: unknown } = '/ask') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Probe />
        <AskPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return user;
}
