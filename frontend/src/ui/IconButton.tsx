import { Button as BaseButton } from '@base-ui/react/button';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';

import styles from './IconButton.module.css';
import { cx } from './cx';

/** onDark = masthead `.icon-btn`; outline = bordered on paper; plain = muted glyph (rail close). */
export type IconButtonTone = 'onDark' | 'outline' | 'plain';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Accessible name. Required: an icon-only control has no visible text. */
  label: string;
  /** Decorative glyph (rendered aria-hidden). */
  icon: ReactNode;
  tone?: IconButtonTone;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tone = 'plain', type = 'button', className, title, ...rest },
  ref,
) {
  return (
    <BaseButton
      ref={ref as Ref<HTMLElement>}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cx(styles.iconButton, styles[tone], className)}
      {...rest}
    >
      <span aria-hidden="true" className={styles.glyph}>
        {icon}
      </span>
    </BaseButton>
  );
});
