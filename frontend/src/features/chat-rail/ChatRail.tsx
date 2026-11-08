import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { getChatStatus } from '../../api/endpoints';
import { ChatMessageView, ensureKatex } from '../chat-render';
import { Rail, RailResizeHandle, usePanel, useRailResize } from '../../ui';

import { useBookContext } from './bookContext';
import { ChatForm } from './ChatForm';
import styles from './ChatRail.module.css';
import { statusText } from './statusLine';
import { useChatThread } from './useChatThread';

const STATUS_KEY = ['chat', 'status'] as const;

/**
 * Reader chat panel (port of chat.js + the aside#chat markup). Stateless: history lives
 * in this component only. Options changes arrive as an invalidation of `['chat']`.
 */
export function ChatRail() {
  const queryClient = useQueryClient();
  const context = useBookContext();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const resize = useRailResize();
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: ({ signal }) => getChatStatus({ signal }),
  });
  const { refetch } = status;
  const panel = usePanel('chat', {
    onOpen: () => {
      ensureKatex().catch(() => {});
      void refetch();
    },
  });

  // "Answered by ..." replaces the status line until the status is re-read (model change).
  const [answered, setAnswered] = useState<{ text: string; stamp: number } | null>(null);
  const thread = useChatThread(context, ({ provider, model }) =>
    setAnswered({
      text: `Answered by ${provider} · ${model}`,
      stamp: queryClient.getQueryState(STATUS_KEY)?.dataUpdatedAt ?? 0,
    }),
  );

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [thread.log]);

  const line =
    answered && answered.stamp === status.dataUpdatedAt
      ? answered.text
      : statusText(status.data, status.isError);
  const name = context.book ? context.book.split('/').pop() : null;

  return (
    <Rail
      {...panel.railProps}
      label="Ask the library"
      title="Ask"
      closeLabel="Close chat"
      side="right"
      width={resize.width}
      handle={<RailResizeHandle resize={resize} />}
      initialFocusRef={inputRef}
    >
      {name ? (
        <div className={styles.context}>
          <span>Asking about</span>
          <b>{name}</b>
          {context.page ? <b>p.{context.page}</b> : null}
        </div>
      ) : null}
      <div className={styles.status} title={line}>
        {line}
      </div>
      <div className={styles.error} role="alert">
        {thread.error}
      </div>
      <div ref={logRef} className={styles.log} role="log" aria-live="polite">
        {thread.log.map((entry) => (
          <ChatMessageView key={entry.id} message={entry} pending={entry.pending} />
        ))}
      </div>
      <ChatForm busy={thread.busy} inputRef={inputRef} onSend={thread.send} />
    </Rail>
  );
}
