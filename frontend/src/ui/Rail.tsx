import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';

import styles from './Rail.module.css';
import { cx } from './cx';
import { IconButton } from './IconButton';
import { firstControl, focusables } from './focusables';
import { MOBILE_QUERY, useMediaQuery } from './useMediaQuery';

export interface RailProps {
  /** Element id; matches `aria-controls` on the toggle. */
  id: string;
  open: boolean;
  onClose: () => void;
  /** Accessible name of the landmark (legacy `aria-label`, e.g. "Researcher notepad"). */
  label: string;
  /** Visible heading; omit for a rail with its own header. */
  title?: string;
  closeLabel?: string;
  /** Edge it docks to. Left rails (contents) get a right border. */
  side?: 'left' | 'right';
  /** Desktop width in px (resizable chat rail). Phones always use the sheet width. */
  width?: number;
  /**
   * Tab wrap inside the rail: phones only (default) or always (exact shell.js behaviour).
   */
  trapFocus?: 'mobile' | 'always';
  /** Overrides "first input/textarea/select/button" as the control focused on open. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Absolutely-positioned slot on the rail edge, e.g. `<RailResizeHandle>`. */
  handle?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * Side panel (legacy `.rail`): sticky column on desktop, fixed sheet with a scrim on
 * phones. Presentational and controlled; pair it with `usePanel(id).railProps`.
 */
export function Rail({
  id,
  open,
  onClose,
  label,
  title,
  closeLabel,
  side = 'right',
  width,
  trapFocus = 'mobile',
  initialFocusRef,
  handle,
  children,
  className,
}: RailProps) {
  const ref = useRef<HTMLElement>(null);
  const mobile = useMediaQuery(MOBILE_QUERY);

  useEffect(() => {
    if (!open || !ref.current) return;
    const target = initialFocusRef?.current ?? firstControl(ref.current);
    target?.focus({ preventScroll: true });
  }, [open, initialFocusRef]);

  // Tab wrapping is a native listener: the landmark itself is not an interactive element.
  useEffect(() => {
    const node = ref.current;
    if (!open || !node || (trapFocus === 'mobile' && !mobile)) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const list = focusables(node);
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [open, mobile, trapFocus]);

  const style = width === undefined ? undefined : ({ '--rail-width': `${width}px` } as CSSProperties);
  return (
    <>
      {open ? (
        <button type="button" tabIndex={-1} aria-label="Close panel" className={styles.scrim} onClick={onClose} />
      ) : null}
      <aside
        ref={ref}
        id={id}
        role={mobile ? 'dialog' : undefined}
        aria-modal={mobile ? true : undefined}
        aria-label={label}
        hidden={!open}
        style={style}
        className={cx(styles.rail, side === 'left' ? styles.left : styles.right, className)}
      >
        {handle}
        {title ? (
          <div className={styles.head}>
            <h2 className={styles.title}>{title}</h2>
            <IconButton label={closeLabel ?? `Close ${title.toLowerCase()}`} icon="×" onClick={onClose} />
          </div>
        ) : null}
        {children}
      </aside>
    </>
  );
}

/** Scrollable region under the header (legacy `.rail-body`). */
export function RailBody({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cx(styles.body, className)}>{children}</div>;
}
