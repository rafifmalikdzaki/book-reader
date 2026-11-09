import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError } from '../../api/client';
import type { ChatSource } from '../../api/types';
import {
  cancelChatSession,
  getChatSession,
  getChatStatus,
  listChatSessions,
} from '../../api/endpoints';
import { CHAT_STATUS_KEY } from '../../app';
import { EXPIRED_NOTICE, OPEN_FAILED_NOTICE } from './format';
import { SESSIONS_KEY, sessionKey } from './keys';

/**
 * Server state for /ask: the sessions index, chat status, and the open session. A failed
 * session load (404 = expired or deleted) drops `?chat=` and leaves a notice behind.
 */
export function useAskData(
  chatId: string | null,
  expired: boolean,
  select: (id: null) => void,
  sending = false,
) {
  const list = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => listChatSessions(),
    staleTime: 15_000,
  });
  const client = useQueryClient();
  const [liveStep, setLiveStep] = useState<string>('');
  const [liveSteps, setLiveSteps] = useState<string[]>([]);
  const [liveFound, setLiveFound] = useState<ChatSource[]>([]);
  const [liveThought, setLiveThought] = useState<string>('');
  const [liveElapsed, setLiveElapsed] = useState<number>(0);
  const [streamingText, setStreamingText] = useState<string>('');
  const status = useQuery({ queryKey: CHAT_STATUS_KEY, queryFn: () => getChatStatus() });
  // The POST that starts a run blocks until the answer is done, so the cached session is still
  // idle while it runs; `sending` is what tells us to poll and subscribe to live events.
  const detail = useQuery({
    queryKey: sessionKey(chatId ?? ''),
    queryFn: () => getChatSession(chatId ?? ''),
    enabled: chatId !== null,
    staleTime: 30_000,
    refetchInterval: (q) => (sending || q.state.data?.status === 'thinking' ? 1000 : false),
  });
  const live = sending || detail.data?.status === 'thinking';

  useEffect(() => {
    if (!chatId || !live) {
      return;
    }
    if (typeof EventSource === 'undefined') return;
    const reset = () => {
      setLiveStep('');
      setLiveSteps([]);
      setLiveFound([]);
      setLiveThought('');
      setLiveElapsed(0);
      setStreamingText('');
    };
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const connect = () => {
      const next = new EventSource(`/api/chat/sessions/${encodeURIComponent(chatId)}/events`);
      source = next;
      next.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'step') {
            const step = String(payload.step || '');
            if (step) setLiveStep(step);
            if (Array.isArray(payload.steps)) {
              setLiveSteps(payload.steps.map(String));
            } else if (step) {
              setLiveSteps((prev) => (prev.includes(step) ? prev : [...prev, step]));
            }
            if (typeof payload.elapsed === 'number') {
              setLiveElapsed(payload.elapsed);
            }
          } else if (payload.type === 'found') {
            if (Array.isArray(payload.found)) setLiveFound(payload.found as ChatSource[]);
          } else if (payload.type === 'thought') {
            const delta = String(payload.delta || '');
            if (delta) setLiveThought((prev) => prev + delta);
          } else if (payload.type === 'delta') {
            const delta = String(payload.delta || '');
            if (delta) setStreamingText((prev) => prev + delta);
          } else if (payload.type === 'done') {
            finished = true;
            client.setQueryData(sessionKey(chatId), payload.session);
            void client.invalidateQueries({ queryKey: SESSIONS_KEY });
            reset();
            next.close();
          } else if (payload.type === 'error') {
            finished = true;
            reset();
            next.close();
          }
        } catch {
          // ignore malformed events
        }
      };
      // The server ends the stream at once when no run has started yet (the POST can land
      // after this connect), so retry while the run is still live instead of giving up.
      next.onerror = () => {
        next.close();
        if (!finished) retry = setTimeout(connect, 500);
      };
    };
    connect();
    return () => {
      finished = true;
      clearTimeout(retry);
      source?.close();
      reset();
    };
  }, [chatId, live, client]);

  async function cancelGeneration() {
    if (!chatId) return;
    try {
      const res = await cancelChatSession(chatId);
      client.setQueryData(sessionKey(chatId), res.session);
      void client.invalidateQueries({ queryKey: SESSIONS_KEY });
    } catch {
      // ignore
    } finally {
      setLiveStep('');
      setLiveSteps([]);
      setLiveFound([]);
      setLiveThought('');
      setLiveElapsed(0);
      setStreamingText('');
    }
  }

  const [notice, setNotice] = useState(expired ? EXPIRED_NOTICE : '');
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failure = chatId !== null && detail.isError ? detail.error : null;
  // Adjust state while rendering (not in an effect) when a load newly fails.
  if (failure && failedFor !== chatId) {
    setFailedFor(chatId);
    setNotice(
      failure instanceof ApiError && failure.status === 404 ? EXPIRED_NOTICE : OPEN_FAILED_NOTICE,
    );
  } else if (!failure && failedFor !== null) {
    setFailedFor(null);
  }
  useEffect(() => {
    if (failure) select(null);
  }, [failure, select]);

  const session = chatId !== null && !detail.isError ? detail.data : undefined;
  return {
    sessions: list.data?.sessions ?? [],
    projects: list.data?.projects ?? [],
    categories: list.data?.categories ?? [],
    retentionDays: list.data?.retention_days,
    listLoaded: list.isSuccess,
    listError: list.error instanceof Error ? list.error.message : '',
    status: status.data,
    statusFailed: status.isError,
    session,
    sessionStatus: detail.data?.status ?? 'idle',
    thoughtStep: liveStep || detail.data?.thought_step || '',
    liveSteps,
    liveFound,
    liveThought,
    liveElapsed,
    streamingText,
    cancelGeneration,
    loadingSession: chatId !== null && detail.isPending,
    /** A loaded session supersedes any earlier notice. */
    notice: session ? '' : notice,
    clearNotice: () => setNotice(''),
  };
}
