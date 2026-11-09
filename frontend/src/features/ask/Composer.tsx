import type { KeyboardEvent, Ref } from 'react';

import type { ChatMode } from '../../api/types';
import { Button, Textarea } from '../../ui';
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

/** Enter sends, Shift+Enter inserts a newline (ask.js keydown handler). */
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
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  }
  return (
    <div className={styles.composerWrap}>
      {onModeChange ? (
        <div className={styles.modeBar} role="group" aria-label="Teaching mode">
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
          <span className={styles.modeHint}>
            {mode === 'tutor'
              ? 'Jane Street Socratic Tutor: diagnostic skill map + one question at a time'
              : 'Master Teacher: intuition, formal math & structured OpenUI cards'}
          </span>
        </div>
      ) : null}
      <form
        className={styles.composer}
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Textarea
          ref={inputRef}
          name="question"
          rows={2}
          value={value}
          placeholder={
            mode === 'tutor'
              ? 'Pick a chapter or concept to master Socratically… (Enter to send)'
              : 'Ask about your books… (Enter to send)'
          }
          aria-label="Ask about your books"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {busy && onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Stop
          </Button>
        ) : null}
        <Button type="submit" loading={busy} disabled={disabled}>
          {busy ? 'Thinking…' : 'Send'}
        </Button>
      </form>
    </div>
  );
}
