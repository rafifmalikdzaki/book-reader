import styles from './RailResizeHandle.module.css';
import type { RailResize } from './useRailResize';

export interface RailResizeHandleComponentProps {
  resize: RailResize;
  label?: string;
}

/**
 * Focusable separator on a rail's left edge. Pass as `<Rail handle={...}>`.
 * Renders nothing below 901px (the rail is a sheet there).
 */
export function RailResizeHandle({ resize, label = 'Resize chat panel' }: RailResizeHandleComponentProps) {
  if (!resize.enabled) return null;
  return (
    <div
      {...resize.handleProps}
      aria-label={label}
      title="Drag to resize"
      className={styles.handle}
      data-dragging={resize.dragging || undefined}
    />
  );
}
