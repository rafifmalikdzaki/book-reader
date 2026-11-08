import type { ReactNode } from 'react';

import styles from './EmptyState.module.css';
import { cx } from './cx';

export interface EmptyStateProps {
  /** Heading; the inline variant usually has none. */
  title?: string;
  headingLevel?: 2 | 3;
  children?: ReactNode;
  /** Buttons or prompt chips under the copy. */
  actions?: ReactNode;
  /** hero = centred `.ask-empty` panel; inline = one muted line (`.side-empty`, `.empty-table`). */
  variant?: 'hero' | 'inline';
  className?: string;
}

export function EmptyState({
  title,
  headingLevel = 2,
  children,
  actions,
  variant = 'inline',
  className,
}: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={cx(styles.empty, styles[variant], className)}>
      {title ? <Heading className={styles.title}>{title}</Heading> : null}
      {children ? <p className={styles.copy}>{children}</p> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
