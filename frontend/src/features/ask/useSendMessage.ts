import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { createChatSession, postMessage } from '../../api/endpoints';
import type { ChatMode, ChatSession, ChatSessionCreate } from '../../api/types';
import { SESSIONS_KEY, sessionKey } from './keys';

/** The optimistic turn: shown until the stored session reports more messages than `base`. */
export interface PendingTurn {
  text: string;
  base: number;
}

interface Args {
  session: ChatSession | undefined;
  draft: { book: string | null; page: number | null; categories: string[] };
  canSend: boolean;
  setText: (update: (current: string) => string) => void;
  onError: (message: string) => void;
  select: (id: string) => void;
}

/** Port of ask.js `sendMessage`: optimistic append, lazy session creation, restore on failure. */
export function useSendMessage({ session, draft, canSend, setText, onError, select }: Args) {
  const client = useQueryClient();
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const inFlight = useRef(false);

  async function send(raw: string, scopeBusy: boolean, mode?: ChatMode): Promise<void> {
    const text = raw.trim();
    if (!text || inFlight.current || scopeBusy || !canSend) return;
    inFlight.current = true;
    onError('');
    setText(() => '');
    setPending({ text, base: session?.messages.length ?? 0 });
    let id = session?.id ?? null;
    try {
      if (!id) {
        const body: ChatSessionCreate = { categories: draft.categories };
        if (draft.book) {
          body.book = draft.book;
          if (draft.page) body.page = draft.page;
        }
        const created = await createChatSession(body);
        client.setQueryData(sessionKey(created.id), created);
        id = created.id;
        select(id);
      }
      const data =
        mode && mode !== 'teacher'
          ? await postMessage(id, text, { mode })
          : await postMessage(id, text);
      client.setQueryData(sessionKey(id), data.session);
      await client.invalidateQueries({ queryKey: SESSIONS_KEY });
    } catch (error) {
      const isConflict = error instanceof ApiError && error.status === 409;
      const isCancelled = error instanceof ApiError && error.status === 499;
      if (!isConflict && !isCancelled) {
        setText((current) => (current.trim() ? current : raw));
      }
      if (!isCancelled) {
        onError(
          isConflict
            ? 'The research agent is already generating an answer.'
            : error instanceof Error
              ? error.message
              : 'The request failed.',
        );
      }
      if (id) await client.invalidateQueries({ queryKey: sessionKey(id) });
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  return { pending, busy: pending !== null, send };
}
