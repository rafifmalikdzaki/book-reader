import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

import styles from './Input.module.css';
import { cx } from './cx';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Legacy `.field` text input. Give it a name via `<Field>` or `aria-label`. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(styles.field, className)} {...rest} />;
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Legacy `textarea.field`: auto height, vertical resize. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(styles.field, styles.textarea, className)} {...rest} />;
});
