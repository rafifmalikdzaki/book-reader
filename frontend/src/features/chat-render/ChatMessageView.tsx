import { useState } from 'react';

import type { ChatRole, ChatSource } from '../../api/types';
import { cx } from '../../ui/cx';

import styles from './ChatRender.module.css';
import { AgentTrace } from './agent/AgentTrace';
import { MarkdownAnswer } from './MarkdownAnswer';
import { SourceList } from './SourceList';

export interface ChatMessageData {
  role: ChatRole;
  content: string;
  sources?: ChatSource[];
  provider?: string;
  model?: string;
  thought_steps?: string[];
  thought?: string;
}

export interface ChatMessageViewProps {
  message: ChatMessageData;
  /** "…thinking" placeholder styling. */
  pending?: boolean;
  /** `bubble` = reader rail card; `thread` = the wider Ask page (borderless answers). */
  variant?: 'bubble' | 'thread';
  className?: string;
  /** Optional handler triggered when the user clicks an interactive OpenUI chip. */
  onPrompt?: (prompt: string) => void;
}

/** One chat turn (legacy `ChatRender.messageNode`): user text verbatim, assistant as Markdown + OpenUI. */
export function ChatMessageView({
  message,
  pending = false,
  variant = 'bubble',
  className,
  onPrompt,
}: ChatMessageViewProps) {
  const [copied, setCopied] = useState(false);

  function copyAnswer() {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }

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
      {message.role === 'assistant' && !pending && (message.thought_steps?.length || message.thought) ? (
        <div className={styles.thoughtTrace}>
          <AgentTrace
            working={false}
            active=""
            done={`Research & reasoning process (${message.thought_steps?.length || 1} step${(message.thought_steps?.length || 1) === 1 ? '' : 's'})`}
            rows={(message.thought_steps ?? []).map((text) => ({ text }))}
          />
          {message.thought ? (
            <div className={styles.thoughtContentText}>{message.thought}</div>
          ) : null}
        </div>
      ) : null}
      {message.role === 'assistant' ? (
        <MarkdownAnswer text={message.content} onPrompt={onPrompt} />
      ) : (
        message.content
      )}
      {message.sources?.length ? <SourceList sources={message.sources} /> : null}
      {message.role === 'assistant' && !pending && variant === 'thread' ? (
        <div className={styles.msgFooter}>
          {message.provider && message.model ? (
            <span className={styles.msgModel} translate="no">
              {message.provider} · {message.model}
            </span>
          ) : null}
          <button
            type="button"
            className={styles.copyBtn}
            aria-label="Copy response"
            onClick={copyAnswer}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
