import type { ChatSource, StoredMessage } from '../../api/types';
import { EmptyState, useStickToBottom } from '../../ui';
import { ChatMessageView } from '../chat-render';
import styles from './AskPage.module.css';
import { ProcessCard } from './ProcessCard';
import { BOOK_PROMPTS, LIBRARY_PROMPTS, OPENUI_SHOWCASE, tourPrompt } from './prompts';
import type { PendingTurn } from './useSendMessage';

interface Props {
  /** Changes when another chat opens, so the log re-pins to its bottom. */
  sessionId?: string;
  messages: StoredMessage[];
  pending: PendingTurn | null;
  loading: boolean;
  aboutBook: boolean;
  notice: string;
  thoughtStep?: string;
  liveSteps?: string[];
  liveFound?: ChatSource[];
  liveThought?: string;
  liveElapsed?: number;
  streamingText?: string;
  sessionStatus?: 'idle' | 'thinking' | 'error';
  onPrompt: (text: string) => void;
  onActionPrompt?: (text: string) => void;
}

/** The scrolling `role="log"` thread: stored turns, the optimistic turn, or the empty state. */
export function Transcript({
  sessionId,
  messages,
  pending,
  loading,
  aboutBook,
  notice,
  thoughtStep,
  liveSteps = [],
  liveFound = [],
  liveThought = '',
  liveElapsed = 0,
  streamingText = '',
  sessionStatus = 'idle',
  onPrompt,
  onActionPrompt,
}: Props) {
  const lastMessage = messages[messages.length - 1];
  const lastIsUser = lastMessage?.role === 'user';
  const showOptimisticUser =
    pending !== null && (!lastIsUser || lastMessage.content !== pending.text);
  const isThinking = pending !== null || sessionStatus === 'thinking';
  const handleTurnPrompt = onActionPrompt ?? onPrompt;
  const blank = messages.length === 0 && !showOptimisticUser && !isThinking && !loading;

  const { ref: box, onScroll } = useStickToBottom<HTMLDivElement>(
    `${messages.length}|${isThinking}|${thoughtStep}|${liveSteps.length}|${liveFound.length}|${liveThought.length}|${streamingText.length}`,
    showOptimisticUser ? pending?.text : null,
    sessionId,
    // The empty-state hero is taller than the viewport on short screens; a
    // bottom pin would clip its title, so anchor to the top while blank.
    blank ? 'hero' : undefined,
  );

  return (
    <div
      ref={box}
      onScroll={onScroll}
      className={styles.thread}
      role="log"
      aria-live="polite"
      aria-busy={loading || isThinking}
    >
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
            <button
              type="button"
              className={`${styles.showcaseCard} ${styles.showcaseTour}`}
              onClick={() => onPrompt(tourPrompt(aboutBook))}
            >
              <strong className={styles.showcaseTitle}>Capability tour</strong>
              <span className={styles.showcaseDesc}>
                One ready-made prompt: cited search, math, and every visual block in a single answer
              </span>
            </button>
            {OPENUI_SHOWCASE.map((item) => (
              <button
                key={item.badge}
                type="button"
                className={styles.showcaseCard}
                onClick={() => onPrompt(item.prompt)}
              >
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
        <ProcessCard
          step={thoughtStep}
          steps={liveSteps}
          found={liveFound}
          thought={liveThought}
          elapsed={liveElapsed}
        />
      ) : null}
    </div>
  );
}
