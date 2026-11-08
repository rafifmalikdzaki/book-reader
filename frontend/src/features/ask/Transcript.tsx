import { useEffect, useRef } from 'react';

import type { StoredMessage } from '../../api/types';
import { EmptyState } from '../../ui';
import { ChatMessageView } from '../chat-render';
import styles from './AskPage.module.css';
import type { PendingTurn } from './useSendMessage';

const BOOK_PROMPTS = [
  'Summarize this page',
  'Find related passages in this book',
  'What does this section argue?',
];
const LIBRARY_PROMPTS = [
  'Find passages about a topic',
  'Compare two books',
  'Trace an idea across the library',
];

interface Props {
  messages: StoredMessage[];
  pending: PendingTurn | null;
  loading: boolean;
  aboutBook: boolean;
  notice: string;
  onPrompt: (text: string) => void;
}

/** The scrolling `role="log"` thread: stored turns, the optimistic turn, or the empty state. */
export function Transcript({ messages, pending, loading, aboutBook, notice, onPrompt }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const showPending = pending !== null && messages.length <= pending.base;
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages.length, showPending]);

  const blank = messages.length === 0 && !showPending && !loading;
  return (
    <div ref={box} className={styles.thread} role="log" aria-live="polite" aria-busy={loading}>
      {blank ? (
        <EmptyState
          variant="hero"
          title="Ask the library"
          actions={(aboutBook ? BOOK_PROMPTS : LIBRARY_PROMPTS).map((text) => (
            <button key={text} type="button" className={styles.prompt} onClick={() => onPrompt(text)}>
              {text}
            </button>
          ))}
        >
          {aboutBook
            ? 'Questions use this book and cite the pages they draw from.'
            : 'Answers search your books and cite the page or line they used.'}
          {notice ? <span className={styles.notice}>{notice}</span> : null}
        </EmptyState>
      ) : null}
      {messages.map((message) => (
        <ChatMessageView key={message.id} message={message} variant="thread" />
      ))}
      {showPending ? (
        <>
          <ChatMessageView message={{ role: 'user', content: pending.text }} variant="thread" />
          <ChatMessageView
            message={{ role: 'assistant', content: 'Searching the library…' }}
            variant="thread"
            pending
          />
        </>
      ) : null}
    </div>
  );
}
