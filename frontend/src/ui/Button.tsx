import { forwardRef, type ButtonHTMLAttributes } from 'react';

import styles from './Button.module.css';
import { cx } from './cx';

/**
 * primary = legacy `.btn`, ghost = `.btn.secondary`, danger = destructive,
 * onDark = masthead `.ghost-btn` (brass outline on baize; `aria-pressed` fills it).
 */
export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'onDark';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** When true, displays an inline spinner, marks aria-busy and disables clicks. */
  loading?: boolean;
}

/** Class names for giving an `<a>` (router Link) the look of a button. */
export function buttonClassName(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cx(styles.button, styles[variant], styles[size], className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', type = 'button', loading = false, disabled, className, children, ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading ? 'true' : undefined}
      className={cx(buttonClassName(variant, size, className), loading && styles.loading)}
      {...rest}
    >
      {loading ? <span aria-hidden="true" className={styles.spinner} /> : null}
      {children}
    </button>
  );
});
