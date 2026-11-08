import type { KeyboardEvent, Ref } from 'react';

import { Button, Textarea } from '../../ui';
import styles from './AskPage.module.css';

interface Props {
  value: string;
  inputRef: Ref<HTMLTextAreaElement>;
  busy: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

/** Enter sends, Shift+Enter inserts a newline (ask.js keydown handler). */
export function Composer({ value, inputRef, busy, disabled, onChange, onSubmit }: Props) {
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  }
  return (
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
        rows={2}
        value={value}
        placeholder="Ask about your books… (Enter to send)"
        aria-label="Ask about your books"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button type="submit" disabled={disabled}>
        {busy ? 'Thinking…' : 'Send'}
      </Button>
    </form>
  );
}
