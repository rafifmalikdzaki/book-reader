import { Button as BaseButton } from '@base-ui/react/button';
import { forwardRef, type ButtonHTMLAttributes, type Ref } from 'react';

import styles from './LinkButton.module.css';
import { cx } from './cx';

/** brass = `.ask-project-create > button`, danger = `.remove`, muted = `.mini` / dock close. */
export type LinkButtonTone = 'brass' | 'danger' | 'muted';

export interface LinkButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: LinkButtonTone;
}

/** A real `<button>` that reads as an inline text action (no border or fill). */
export const LinkButton = forwardRef<HTMLButtonElement, LinkButtonProps>(function LinkButton(
  { tone = 'brass', type = 'button', className, ...rest },
  ref,
) {
  return (
    <BaseButton
      ref={ref as Ref<HTMLElement>}
      type={type}
      className={cx(styles.link, styles[tone], className)}
      {...rest}
    />
  );
});
