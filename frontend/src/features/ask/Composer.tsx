import type { Ref } from 'react';

import type { ChatMode } from '../../api/types';
import { PromptBar } from '../chat-render/agent/PromptBar';
import styles from './AskPage.module.css';

interface Props {
  value: string;
  inputRef: Ref<HTMLTextAreaElement>;
  busy: boolean;
  disabled: boolean;
  mode?: ChatMode;
  onModeChange?: (mode: ChatMode) => void;
  onCancel?: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

/** Mode segmented control above the shared PromptBar (ported beautiful-ui primitive). */
export function Composer({
  value,
  inputRef,
  busy,
  disabled,
  mode = 'teacher',
  onModeChange,
  onCancel,
  onChange,
  onSubmit,
}: Props) {
  return (
    <div className={styles.composerWrap}>
      {onModeChange ? (
        <div className={styles.modeBar} role="group" aria-label="Teaching mode">
          <span className={styles.modeSegmented}>
            <button
              type="button"
              className={mode === 'teacher' ? `${styles.modeBtn} ${styles.modeActive}` : styles.modeBtn}
              aria-pressed={mode === 'teacher'}
              onClick={() => onModeChange('teacher')}
            >
              Explain
            </button>
            <button
              type="button"
              className={mode === 'tutor' ? `${styles.modeBtn} ${styles.modeActive}` : styles.modeBtn}
              aria-pressed={mode === 'tutor'}
              onClick={() => onModeChange('tutor')}
            >
              Socratic Tutor
            </button>
          </span>
          <span className={styles.modeHint}>
            {mode === 'tutor'
              ? 'Jane Street Socratic Tutor: diagnostic skill map + one question at a time'
              : 'Master Teacher: intuition, formal math & structured OpenUI cards'}
          </span>
        </div>
      ) : null}
      <PromptBar
        value={value}
        inputRef={inputRef}
        ariaLabel="Ask about your books"
        placeholder={
          mode === 'tutor'
            ? 'Pick a chapter or concept to master Socratically… (Enter to send)'
            : 'Ask about your books… (Enter to send)'
        }
        busy={busy}
        disabled={disabled || busy}
        actionLabel="Send"
        busyLabel="Thinking…"
        stopLabel="Stop"
        onCancel={onCancel}
        onChange={onChange}
        onSubmit={onSubmit}
      />
    </div>
  );
}
