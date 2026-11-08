import styles from './Segmented.module.css';
import { cx } from './cx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Overrides the accessible name when the label is terse. */
  ariaLabel?: string;
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Library view". */
  label: string;
  className?: string;
}

/**
 * Legacy `.view-toggle`: a row of toggle buttons where the current one has
 * `aria-pressed="true"` (a button group, not a tablist).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={cx(styles.segmented, className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.ariaLabel}
          aria-pressed={option.value === value}
          className={styles.option}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
