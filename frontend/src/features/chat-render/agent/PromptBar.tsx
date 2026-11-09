import { useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';

import styles from './PromptBar.module.css';

/* Ported from beautiful-ui primitives/PromptBar.tsx (MIT, slev12397/beautiful-ui).
 * The @-menu / /-menu / dictation demo machinery is dropped; the bar keeps its
 * structure: leading slot (scope chip), auto-growing textarea, trailing action.
 * Enter sends, Shift+Enter newline — unchanged app behavior. */

export interface PromptBarProps {
  value: string;
  inputRef: Ref<HTMLTextAreaElement>;
  placeholder: string;
  ariaLabel: string;
  busy?: boolean;
  disabled?: boolean;
  /** Trailing action label for screen readers ("Send"). */
  actionLabel: string;
  /** Label while a request is pending (e.g. "Thinking…"); falls back to actionLabel. */
  busyLabel?: string;
  stopLabel?: string;
  onCancel?: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Leading slot inside the bar, e.g. the @ book scope chip. */
  leading?: ReactNode;
}

export function PromptBar({
  value,
  inputRef,
  placeholder,
  ariaLabel,
  busy = false,
  disabled = false,
  actionLabel,
  busyLabel,
  stopLabel = 'Stop',
  onCancel,
  onChange,
  onSubmit,
  leading,
}: PromptBarProps) {
  const [focused, setFocused] = useState(false);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <form
      className={styles.bar}
      data-focused={focused}
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {leading ? <span className={styles.leading}>{leading}</span> : null}
      <textarea
        ref={inputRef}
        name="question"
        rows={2}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={styles.input}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {busy && onCancel ? (
        <button
          type="button"
          className={styles.action}
          data-variant="stop"
          aria-label={stopLabel}
          onClick={onCancel}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="2.5" />
          </svg>
        </button>
      ) : null}
      <button
        type="submit"
        className={styles.action}
        aria-label={busy && busyLabel ? busyLabel : actionLabel}
        disabled={disabled || busy}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      </button>
    </form>
  );
}
