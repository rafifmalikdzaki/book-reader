import styles from './ProgressBar.module.css';
import { cx } from './cx';

export interface ProgressBarProps {
  /** Current value, 0..max. */
  value: number;
  max?: number;
  /** Accessible name, e.g. "Reading progress". */
  label: string;
  /** Human-readable value for assistive tech, e.g. "Page 12 of 340". */
  valueText?: string;
  /** md = 5px (book plate), thin = 3px (tiles). */
  size?: 'md' | 'thin';
  className?: string;
}

/** Legacy `.progress`: a brass fill on a soft rule track. */
export function ProgressBar({ value, max = 100, label, valueText, size = 'md', className }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 100;
  const clamped = Math.min(safeMax, Math.max(0, Number.isFinite(value) ? value : 0));
  const percent = (clamped / safeMax) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      aria-valuetext={valueText}
      className={cx(styles.track, size === 'thin' && styles.thin, className)}
    >
      <i className={styles.fill} style={{ width: `${percent}%` }} />
    </div>
  );
}
