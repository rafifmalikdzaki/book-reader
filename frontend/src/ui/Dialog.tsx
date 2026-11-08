import * as RadixDialog from '@radix-ui/react-dialog';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

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
 * Modal dialog (legacy `<dialog class="options">` look). Radix supplies the focus trap,
 * Esc handling, aria-modal, scroll lock and focus restore to the opener.
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
  // Controlled dialogs have no Radix <Trigger>, so remember the opener ourselves.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
  }, [open]);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content
          className={cx(styles.content, size === 'sm' && styles.sm, className)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus({ preventScroll: true });
          }}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
          {description ? (
            <RadixDialog.Description className={styles.description}>
              {description}
            </RadixDialog.Description>
          ) : null}
          {children}
          {showClose ? (
            <RadixDialog.Close asChild>
              <IconButton label="Close" icon="×" className={styles.close} />
            </RadixDialog.Close>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
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
