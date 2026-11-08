import { useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';

import { Button, Textarea } from '../../ui';

import styles from './ChatRail.module.css';

interface Props {
  busy: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** Resolves true when the question was accepted (the draft is then cleared). */
  onSend: (question: string) => Promise<boolean>;
}

/** Enter sends, Shift+Enter inserts a newline (legacy chat.js keydown handler). */
export function ChatForm({ busy, inputRef, onSend }: Props) {
  const [draft, setDraft] = useState('');

  function submit() {
    const question = draft;
    if (busy || !question.trim()) return;
    setDraft('');
    void onSend(question).finally(() => inputRef.current?.focus());
  }

  return (
    <form
      className={styles.form}
      autoComplete="off"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        ref={inputRef}
        rows={2}
        value={draft}
        aria-label="Your question"
        placeholder="Ask about your books… (Enter to send)"
        className={styles.input}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <Button type="submit" disabled={busy}>
        Send
      </Button>
    </form>
  );
}
