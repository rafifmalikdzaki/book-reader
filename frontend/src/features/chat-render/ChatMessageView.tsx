import type { ChatRole, ChatSource } from '../../api/types';
import { cx } from '../../ui/cx';

import styles from './ChatRender.module.css';
import { MarkdownAnswer } from './MarkdownAnswer';
import { SourceList } from './SourceList';

export interface ChatMessageData {
  role: ChatRole;
  content: string;
  sources?: ChatSource[];
  provider?: string;
  model?: string;
}

export interface ChatMessageViewProps {
  message: ChatMessageData;
  /** "…thinking" placeholder styling. */
  pending?: boolean;
  /** `bubble` = reader rail card; `thread` = the wider Ask page (borderless answers). */
  variant?: 'bubble' | 'thread';
  className?: string;
}

/** One chat turn (legacy `ChatRender.messageNode`): user text verbatim, assistant as Markdown. */
export function ChatMessageView({
  message,
  pending = false,
  variant = 'bubble',
  className,
}: ChatMessageViewProps) {
  return (
    <div
      data-role={message.role}
      className={cx(
        styles.msg,
        styles[message.role],
        variant === 'thread' && styles.thread,
        pending && styles.pending,
        className,
      )}
    >
      {message.role === 'assistant' ? <MarkdownAnswer text={message.content} /> : message.content}
      {message.sources?.length ? <SourceList sources={message.sources} /> : null}
    </div>
  );
}
