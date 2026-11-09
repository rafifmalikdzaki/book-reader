import { useState, type RefObject } from 'react';

import { PromptBar } from '../chat-render/agent/PromptBar';

interface Props {
  busy: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** Resolves true when the question was accepted (the draft is then cleared). */
  onSend: (question: string) => Promise<boolean>;
}

/** Reader-rail composer on the shared PromptBar (ported beautiful-ui primitive). */
export function ChatForm({ busy, inputRef, onSend }: Props) {
  const [draft, setDraft] = useState('');

  function submit() {
    const question = draft;
    if (busy || !question.trim()) return;
    setDraft('');
    void onSend(question).finally(() => inputRef.current?.focus());
  }

  return (
    <PromptBar
      value={draft}
      inputRef={inputRef}
      ariaLabel="Your question"
      placeholder="Ask about your books… (Enter to send)"
      busy={busy}
      disabled={busy}
      actionLabel="Send"
      onChange={setDraft}
      onSubmit={submit}
    />
  );
}
