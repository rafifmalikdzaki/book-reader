import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAskData } from './useAskData';

vi.mock('../../api/endpoints', () => ({
  listChatSessions: vi.fn(async () => ({ sessions: [], projects: [], categories: [] })),
  getChatStatus: vi.fn(async () => ({ available: true })),
  getChatSession: vi.fn(async () => ({ id: 'c1', status: 'idle', messages: [] })),
  cancelChatSession: vi.fn(),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAskData live run', () => {
  it('does not subscribe while the session is idle and nothing is sending', async () => {
    const { result } = renderHook(() => useAskData('c1', false, vi.fn(), false), { wrapper });
    await waitFor(() => expect(result.current.session).toBeDefined());
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('subscribes while a send is in flight even though the cached session is idle', async () => {
    const { result } = renderHook(() => useAskData('c1', false, vi.fn(), true), { wrapper });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe('/api/chat/sessions/c1/events');

    act(() => {
      source.emit({ type: 'step', step: 'Searching library…', steps: ['Searching library…'], elapsed: 2 });
      source.emit({ type: 'found', found: [{ book: 'a.pdf', page: 4, snippet: 'sampling' }] });
      source.emit({ type: 'thought', delta: 'Need the Monte Carlo chapter. ' });
    });
    expect(result.current.liveFound).toEqual([{ book: 'a.pdf', page: 4, snippet: 'sampling' }]);
    expect(result.current.liveSteps).toEqual(['Searching library…']);
    expect(result.current.thoughtStep).toBe('Searching library…');
    expect(result.current.liveElapsed).toBe(2);
    expect(result.current.liveThought).toBe('Need the Monte Carlo chapter. ');
  });

  it('reconnects when the server ends the stream before the run started', async () => {
    renderHook(() => useAskData('c1', false, vi.fn(), true), { wrapper });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() => FakeEventSource.instances[0]!.onerror?.());
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2), { timeout: 2000 });
  });

  it('stops after the done event', async () => {
    const { result } = renderHook(() => useAskData('c1', false, vi.fn(), true), { wrapper });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit({ type: 'step', step: 'Reading…', steps: ['Reading…'] });
      source.emit({ type: 'done', session: { id: 'c1', status: 'idle', messages: [] } });
    });
    expect(source.closed).toBe(true);
    expect(result.current.liveSteps).toEqual([]);
    act(() => source.onerror?.());
    await new Promise((r) => setTimeout(r, 700));
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
