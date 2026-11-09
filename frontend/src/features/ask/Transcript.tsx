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

const OPENUI_SHOWCASE = [
  {
    badge: 'ConceptCard',
    title: 'Concept Breakdown',
    desc: 'Intuition, formal math & worked example',
    prompt: 'Break down a core concept from my library with intuition, formal math, and a ConceptCard',
  },
  {
    badge: 'ConceptGraph',
    title: 'Architecture & Flow',
    desc: 'Interactive node-link diagram of dependencies',
    prompt: 'Map the key concepts and their dependencies as an interactive ConceptGraph',
  },
  {
    badge: 'ComparisonTable',
    title: 'Trade-off Matrix',
    desc: 'Side-by-side comparison across methods or books',
    prompt: 'Compare two approaches or algorithms in my library using a ComparisonTable',
  },
  {
    badge: 'SkillMap',
    title: 'Socratic Mastery',
    desc: '0–5 subskill diagnostic & one question per turn',
    prompt: 'Tutor me Socratically with a diagnostic SkillMap and one question at a time',
  },
] as const;

interface Props {
  messages: StoredMessage[];
  pending: PendingTurn | null;
  loading: boolean;
  aboutBook: boolean;
  notice: string;
  thoughtStep?: string;
  liveSteps?: string[];
  liveThought?: string;
  liveElapsed?: number;
  streamingText?: string;
  sessionStatus?: 'idle' | 'thinking' | 'error';
  onPrompt: (text: string) => void;
  onActionPrompt?: (text: string) => void;
}

/** The scrolling `role="log"` thread: stored turns, the optimistic turn, or the empty state. */
export function Transcript({
  messages,
  pending,
  loading,
  aboutBook,
  notice,
  thoughtStep,
  liveSteps = [],
  liveThought = '',
  liveElapsed = 0,
  streamingText = '',
  sessionStatus = 'idle',
  onPrompt,
  onActionPrompt,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const lastMessage = messages[messages.length - 1];
  const lastIsUser = lastMessage?.role === 'user';
  const showOptimisticUser =
    pending !== null && (!lastIsUser || lastMessage.content !== pending.text);
  const isThinking = pending !== null || sessionStatus === 'thinking';
  const handleTurnPrompt = onActionPrompt ?? onPrompt;

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages.length, showOptimisticUser, isThinking, thoughtStep, liveSteps.length, liveThought, streamingText]);

  const blank = messages.length === 0 && !showOptimisticUser && !isThinking && !loading;
  return (
    <div ref={box} className={styles.thread} role="log" aria-live="polite" aria-busy={loading || isThinking}>
      {blank ? (
        <div className={styles.heroWrap}>
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
          <div className={styles.showcaseGrid} aria-label="Generative UI modes">
            {OPENUI_SHOWCASE.map((item) => (
              <button
                key={item.badge}
                type="button"
                className={styles.showcaseCard}
                onClick={() => onPrompt(item.prompt)}
              >
                <span className={styles.showcaseBadge}>{item.badge}</span>
                <strong className={styles.showcaseTitle}>{item.title}</strong>
                <span className={styles.showcaseDesc}>{item.desc}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {messages.map((message) => (
        <ChatMessageView
          key={message.id}
          message={message}
          variant="thread"
          onPrompt={handleTurnPrompt}
        />
      ))}
      {showOptimisticUser ? (
        <ChatMessageView message={{ role: 'user', content: pending.text }} variant="thread" />
      ) : null}
      {isThinking && streamingText ? (
        <ChatMessageView
          message={{ role: 'assistant', content: streamingText }}
          variant="thread"
          onPrompt={handleTurnPrompt}
        />
      ) : null}
      {isThinking ? (
        <div className={styles.processCard} role="status" aria-live="polite">
          <div className={styles.processHeader}>
            <span className={styles.processSpinner} aria-hidden="true" />
            <div className={styles.processHeaderTitle}>
              <strong>{thoughtStep || 'Searching the library…'}</strong>
              <span className={styles.processSubtitle}>
                {liveSteps.length > 0
                  ? `${liveSteps.length} step${liveSteps.length === 1 ? '' : 's'} executed`
                  : 'Agent active'}
              </span>
            </div>
            {liveElapsed > 0 ? (
              <span className={styles.processElapsed}>{liveElapsed.toFixed(1)}s</span>
            ) : null}
          </div>
          {liveSteps.length > 0 ? (
            <div className={styles.processSteps}>
              {liveSteps.map((step, idx) => {
                const isCurrent = idx === liveSteps.length - 1;
                return (
                  <div
                    key={idx}
                    className={isCurrent ? styles.processStepCurrent : styles.processStepDone}
                  >
                    <span className={styles.processStepIcon} aria-hidden="true">
                      {isCurrent ? '●' : '✓'}
                    </span>
                    <span className={styles.processStepText}>{step}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {liveThought ? (
            <div className={styles.processThoughtStream}>
              <div className={styles.processThoughtHeader}>Model Reasoning Stream</div>
              <div className={styles.processThoughtBody}>{liveThought}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
