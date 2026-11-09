import { useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { askStateless } from '../../api/endpoints';
import type { ChatMode, ChatSource, ChatTurn } from '../../api/types';

export interface LogEntry {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  pending?: boolean;
}

export interface Answered {
  provider: string;
  model: string;
}

const GENERIC = 'The request failed. Try again, or pick another model in Options.';
const NETWORK = 'The request failed. Check the provider key or try another model in Options.';

/**
 * Stateless reader chat (port of chat.js `ask`). `history` is what the server sees; the
 * visible `log` keeps a failed question on screen while dropping it from `history`.
 */
export function useChatThread(
  context: { book: string | null; page: number | null },
  onAnswered?: (answered: Answered) => void,
) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const history = useRef<ChatTurn[]>([]);
  const busyRef = useRef(false);
  const nextId = useRef(0);

  async function send(text: string, mode?: ChatMode): Promise<boolean> {
    const question = text.trim();
    if (busyRef.current || !question) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    const userId = nextId.current++;
    const pendingId = nextId.current++;
    history.current = [...history.current, { role: 'user', content: question }];
    setLog((entries) => [
      ...entries,
      { id: userId, role: 'user', content: question },
      { id: pendingId, role: 'assistant', content: '…thinking', pending: true },
    ]);
    try {
      const payload =
        mode && mode !== 'teacher'
          ? {
              messages: history.current,
              book: context.book,
              page: context.page,
              mode,
            }
          : {
              messages: history.current,
              book: context.book,
              page: context.page,
            };
      const data = await askStateless(payload);
      history.current = [...history.current, { role: 'assistant', content: data.answer }];
      setLog((entries) => [
        ...entries.filter((entry) => entry.id !== pendingId),
        { id: pendingId, role: 'assistant', content: data.answer, sources: data.sources },
      ]);
      onAnswered?.({ provider: data.provider, model: data.model });
    } catch (caught) {
      history.current = history.current.slice(0, -1);
      setLog((entries) => entries.filter((entry) => entry.id !== pendingId));
      setError(caught instanceof ApiError ? caught.detail || GENERIC : NETWORK);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    return true;
  }

  return { log, busy, error, send };
}
