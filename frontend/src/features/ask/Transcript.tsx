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
  'Tutor me on this section',
];
const LIBRARY_PROMPTS = [
  'Find passages about a topic',
  'Compare two books',
  'Trace an idea across the library',
  'Teach me a topic Socratically',
];

interface Props {
  messages: StoredMessage[];
  pending: PendingTurn | null;
  loading: boolean;
  aboutBook: boolean;
  notice: string;
  thoughtStep?: string;
  streamingText?: string;
  sessionStatus?: 'idle' | 'thinking' | 'error';
  onPrompt: (text: string) => void;
}

/** The scrolling `role="log"` thread: stored turns, the optimistic turn, or the empty state. */
export function Transcript({
  messages,
  pending,
  loading,
  aboutBook,
  notice,
  thoughtStep,
  streamingText = '',
  sessionStatus = 'idle',
  onPrompt,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const lastMessage = messages[messages.length - 1];
  const lastIsUser = lastMessage?.role === 'user';
  const showOptimisticUser =
    pending !== null && (!lastIsUser || lastMessage.content !== pending.text);
  const isThinking = pending !== null || sessionStatus === 'thinking';

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages.length, showOptimisticUser, isThinking, thoughtStep, streamingText]);

  const blank = messages.length === 0 && !showOptimisticUser && !isThinking && !loading;
  return (
    <div ref={box} className={styles.thread} role="log" aria-live="polite" aria-busy={loading || isThinking}>
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
        <ChatMessageView
          key={message.id}
          message={message}
          variant="thread"
          onPrompt={onPrompt}
        />
      ))}
      {showOptimisticUser ? (
        <ChatMessageView message={{ role: 'user', content: pending.text }} variant="thread" />
      ) : null}
      {isThinking && streamingText ? (
        <ChatMessageView
          message={{ role: 'assistant', content: streamingText }}
          variant="thread"
          onPrompt={onPrompt}
        />
      ) : null}
      {isThinking ? (
        <div className={styles.thinkingCard} role="status" aria-live="polite">
          <span className={styles.thinkingSpinner} aria-hidden="true" />
          <span>{thoughtStep || 'Searching the library…'}</span>
        </div>
      ) : null}
    </div>
  );
}
