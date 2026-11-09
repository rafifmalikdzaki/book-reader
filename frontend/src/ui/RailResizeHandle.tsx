import { cx } from './cx';
import styles from './RailResizeHandle.module.css';
import type { RailResize } from './useRailResize';

export interface RailResizeHandleComponentProps {
  resize: RailResize;
  label?: string;
  className?: string;
}

/**
 * Focusable separator on a rail's boundary edge. Pass as `<Rail handle={...}>`.
 * Renders nothing below 901px (the rail is a sheet there).
 */
export function RailResizeHandle({
  resize,
  label = 'Resize chat panel',
  className,
}: RailResizeHandleComponentProps) {
  if (!resize.enabled) return null;
  return (
    <div
      {...resize.handleProps}
      aria-label={label}
      title="Drag to resize"
      className={cx(
        styles.handle,
        resize.side === 'left' ? styles.handleLeftRail : styles.handleRightRail,
        className,
      )}
      data-dragging={resize.dragging || undefined}
    />
  );
}
