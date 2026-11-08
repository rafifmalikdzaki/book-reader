import { forwardRef, type SelectHTMLAttributes } from 'react';

import styles from './Select.module.css';
import { cx } from './cx';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** sm = 30px (note groups), md = 34px field height, lg = 38px (options dialog, full width). */
  controlSize?: 'sm' | 'md' | 'lg';
}

/**
 * Native `<select>` in the legacy `.field` skin. Native keeps the platform keyboard and
 * screen-reader behaviour and the mobile picker; label it with `<Field>` or `aria-label`.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { controlSize = 'md', className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx(styles.select, styles[controlSize], className)} {...rest}>
      {children}
    </select>
  );
});
