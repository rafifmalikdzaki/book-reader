import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError } from '../../api/client';
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
export function useAskData(chatId: string | null, expired: boolean, select: (id: null) => void) {
  const list = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => listChatSessions(),
    staleTime: 15_000,
  });
  const client = useQueryClient();
  const [liveStep, setLiveStep] = useState<string>('');
  const [liveSteps, setLiveSteps] = useState<string[]>([]);
  const [liveThought, setLiveThought] = useState<string>('');
  const [liveElapsed, setLiveElapsed] = useState<number>(0);
  const [streamingText, setStreamingText] = useState<string>('');
  const status = useQuery({ queryKey: CHAT_STATUS_KEY, queryFn: () => getChatStatus() });
  const detail = useQuery({
    queryKey: sessionKey(chatId ?? ''),
    queryFn: () => getChatSession(chatId ?? ''),
    enabled: chatId !== null,
    staleTime: 30_000,
    refetchInterval: (q) => (q.state.data?.status === 'thinking' ? 1000 : false),
  });

  useEffect(() => {
    if (!chatId || detail.data?.status !== 'thinking') {
      return;
    }
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/chat/sessions/${encodeURIComponent(chatId)}/events`);
    source.onmessage = (event) => {
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
        } else if (payload.type === 'thought') {
          const delta = String(payload.delta || '');
          if (delta) {
            setLiveThought((prev) => prev + delta);
          }
        } else if (payload.type === 'delta') {
          const delta = String(payload.delta || '');
          if (delta) {
            setStreamingText((prev) => prev + delta);
          }
        } else if (payload.type === 'done') {
          client.setQueryData(sessionKey(chatId), payload.session);
          void client.invalidateQueries({ queryKey: SESSIONS_KEY });
          setLiveStep('');
          setLiveSteps([]);
          setLiveThought('');
          setLiveElapsed(0);
          setStreamingText('');
          source.close();
        } else if (payload.type === 'error') {
          setLiveStep('');
          setLiveSteps([]);
          setLiveThought('');
          setLiveElapsed(0);
          setStreamingText('');
          source.close();
        }
      } catch {
        // ignore
      }
    };
    source.onerror = () => {
      source.close();
    };
    return () => {
      source.close();
      setLiveStep('');
      setLiveSteps([]);
      setLiveThought('');
      setLiveElapsed(0);
      setStreamingText('');
    };
  }, [chatId, detail.data?.status, client]);

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
