import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError } from '../../api/client';
import { getChatSession, getChatStatus, listChatSessions } from '../../api/endpoints';
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
  const status = useQuery({ queryKey: CHAT_STATUS_KEY, queryFn: () => getChatStatus() });
  const detail = useQuery({
    queryKey: sessionKey(chatId ?? ''),
    queryFn: () => getChatSession(chatId ?? ''),
    enabled: chatId !== null,
    staleTime: 30_000,
  });

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
    loadingSession: chatId !== null && detail.isPending,
    /** A loaded session supersedes any earlier notice. */
    notice: session ? '' : notice,
    clearNotice: () => setNotice(''),
  };
}
