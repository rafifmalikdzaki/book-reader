import { Tabs } from '@base-ui/react/tabs';

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
  /** Accessible name of the tab list, e.g. "Library view". */
  label: string;
  className?: string;
}

/**
 * Segmented view switcher on Base UI Tabs: arrow-key navigation between options,
 * `tab`/`tablist` semantics with `aria-selected` (previously a button group with
 * `aria-pressed`). Same look as the legacy `.view-toggle`.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedProps<T>) {
  return (
    <Tabs.Root
      value={value}
      onValueChange={(next) => onChange(next as T)}
      className={cx(styles.segmented, className)}
    >
      <Tabs.List aria-label={label} className={styles.list}>
        {options.map((option) => (
          <Tabs.Tab
            key={option.value}
            value={option.value}
            aria-label={option.ariaLabel}
            className={styles.option}
          >
            {option.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
