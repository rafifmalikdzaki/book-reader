import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';

import styles from './Dialog.module.css';
import { cx } from './cx';
import { IconButton } from './IconButton';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required accessible name, shown as the serif heading. */
  title: string;
  /** Optional muted lead-in; wired to aria-describedby. */
  description?: ReactNode;
  children?: ReactNode;
  /** md = options dialog (440px), sm = ask confirm dialogs (420px). */
  size?: 'sm' | 'md';
  showClose?: boolean;
  className?: string;
}

/**
 * Modal dialog (legacy `<dialog class="options">` look). Base UI supplies the focus
 * trap, Esc handling, aria-modal, scroll lock and focus restore to the opener.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'md',
  showClose = true,
  className,
}: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={styles.overlay} />
        <BaseDialog.Popup className={cx(styles.content, size === 'sm' && styles.sm, className)}>
          <BaseDialog.Title className={styles.title}>{title}</BaseDialog.Title>
          {description ? (
            <BaseDialog.Description className={styles.description}>{description}</BaseDialog.Description>
          ) : null}
          {children}
          {showClose ? (
            <BaseDialog.Close
              render={<IconButton label="Close" icon="×" className={styles.close} />}
            />
          ) : null}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** Right-aligned button row (legacy `.compose-actions` / `.actions`). */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

/** Ruled sub-section inside a dialog (legacy `.options-library`). */
export function DialogSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}
