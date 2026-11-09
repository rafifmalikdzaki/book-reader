import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { getChatStatus } from '../../api/endpoints';
import type { ChatMode } from '../../api/types';
import { ModelEffortBar } from '../chat-model';
import { ChatMessageView, SmartLink, ensureKatex } from '../chat-render';
import { Rail, RailResizeHandle, usePanel, useRailResize, useStickToBottom } from '../../ui';

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
  const resize = useRailResize();
  const [mode, setMode] = useState<ChatMode>('teacher');
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

  const { ref: logRef, onScroll: onLogScroll } = useStickToBottom<HTMLDivElement>(
    thread.log,
    thread.busy,
  );

  const line =
    answered && answered.stamp === status.dataUpdatedAt
      ? answered.text
      : statusText(status.data, status.isError);
  const name = context.book ? context.book.split('/').pop() : null;
  const askHref = context.book
    ? `/ask?book=${encodeURIComponent(context.book)}${context.page ? `&page=${context.page}` : ''}`
    : '/ask';

  return (
    <Rail
      {...panel.railProps}
      className="ask-console"
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
          <SmartLink href={askHref} className={styles.fullLink}>
            Open in /ask →
          </SmartLink>
        </div>
      ) : null}
      <ModelEffortBar variant="compact" />
      <div className={styles.modeBar} role="group" aria-label="Teaching mode">
        <span className={styles.modeSegmented}>
          <button
            type="button"
            className={mode === 'teacher' ? `${styles.modeBtn} ${styles.modeActive}` : styles.modeBtn}
            aria-pressed={mode === 'teacher'}
            onClick={() => setMode('teacher')}
          >
            Explain
          </button>
          <button
            type="button"
            className={mode === 'tutor' ? `${styles.modeBtn} ${styles.modeActive}` : styles.modeBtn}
            aria-pressed={mode === 'tutor'}
            onClick={() => setMode('tutor')}
          >
            Socratic Tutor
          </button>
        </span>
      </div>
      <div className={styles.status} title={line}>
        {line}
      </div>
      <div className={styles.error} role="alert">
        {thread.error}
      </div>
      <div ref={logRef} onScroll={onLogScroll} className={styles.log} role="log" aria-live="polite">
        {thread.log.map((entry) => (
          <ChatMessageView
            key={entry.id}
            message={entry}
            pending={entry.pending}
            onPrompt={(prompt) => void thread.send(prompt, mode)}
          />
        ))}
      </div>
      <ChatForm
        busy={thread.busy}
        inputRef={inputRef}
        onSend={(question) => thread.send(question, mode)}
      />
    </Rail>
  );
}
