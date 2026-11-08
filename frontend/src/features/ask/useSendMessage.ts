import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { createChatSession, postMessage } from '../../api/endpoints';
import type { ChatSession, ChatSessionCreate } from '../../api/types';
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

  async function send(raw: string, scopeBusy: boolean): Promise<void> {
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
      const data = await postMessage(id, text);
      client.setQueryData(sessionKey(id), data.session);
      await client.invalidateQueries({ queryKey: SESSIONS_KEY });
    } catch (error) {
      setText((current) => (current.trim() ? current : raw));
      onError(error instanceof Error ? error.message : 'The request failed.');
      if (id) await client.invalidateQueries({ queryKey: sessionKey(id) });
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  return { pending, busy: pending !== null, send };
}
