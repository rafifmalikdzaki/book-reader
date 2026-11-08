import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface AskUrl {
  chatId: string | null;
  /** Book the next new session is about (`?book=&page=`); ignored while a chat is open. */
  book: string | null;
  page: number | null;
  expired: boolean;
  /** Open a chat (or the blank composer for `null`); replaces the history entry. */
  select: (id: string | null) => void;
}

/** The `/ask` URL contract: `?chat=<id>`, `?book=&page=`, `?expired=1`. */
export function useAskUrl(): AskUrl {
  const [params, setParams] = useSearchParams();
  const select = useCallback(
    (id: string | null) => setParams(id ? { chat: id } : {}, { replace: true }),
    [setParams],
  );
  const chatId = params.get('chat');
  return {
    chatId: chatId || null,
    book: chatId ? null : params.get('book'),
    page: chatId ? null : Number(params.get('page')) || null,
    expired: params.get('expired') === '1',
    select,
  };
}
