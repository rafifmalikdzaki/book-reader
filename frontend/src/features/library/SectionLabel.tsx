import type { ReactNode } from 'react';

import styles from './SectionLabel.module.css';

/** Legacy `.section-label`: the small caps heading above a block. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className={styles.label}>{children}</p>;
}
