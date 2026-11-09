import { Select as BaseSelect } from '@base-ui/react/select';
import {
  Children,
  isValidElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

import styles from './Select.module.css';
import { cx } from './cx';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'onChange'> {
  /** sm = 30px (note groups), md = 34px field height, lg = 38px (options dialog, full width). */
  controlSize?: 'sm' | 'md' | 'lg';
  /** Kept for call-site compatibility; receives a change-shaped event with `target.value`. */
  onChange?: (event: { target: { value: string } }) => void;
}

interface OptionData {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

function readOptions(children: ReactNode): OptionData[] {
  return Children.toArray(children)
    .filter(isValidElement)
    .map((el) => ({
      value: String((el.props as { value?: unknown }).value ?? ''),
      label: (el.props as { children?: ReactNode }).children,
      disabled: Boolean((el.props as { disabled?: boolean }).disabled),
    }));
}

/**
 * Base UI Select in the legacy `.field` skin: styled dropdown with full keyboard
 * navigation (arrows, typeahead, Esc) instead of the native picker. Accepts plain
 * `<option>` children and a change-shaped `onChange`, so call sites are unchanged.
 */
export function Select({
  controlSize = 'md',
  className,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  ...rest
}: SelectProps) {
  const options = readOptions(children);
  return (
    <BaseSelect.Root
      value={value != null ? String(value) : undefined}
      defaultValue={defaultValue != null ? String(defaultValue) : undefined}
      disabled={disabled}
      onValueChange={(next) => onChange?.({ target: { value: next as string } })}
    >
      <BaseSelect.Trigger
        className={cx(styles.select, styles[controlSize], className)}
        id={rest.id}
        aria-label={rest['aria-label']}
        aria-labelledby={rest['aria-labelledby']}
        aria-describedby={rest['aria-describedby']}
        aria-invalid={rest['aria-invalid']}
        aria-required={rest['aria-required']}
        title={rest.title}
      >
        <BaseSelect.Value className={styles.value}>{(v) => options.find((o) => o.value === v)?.label ?? String(v)}</BaseSelect.Value>
        <BaseSelect.Icon className={styles.chevron} aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className={styles.positioner}>
          <BaseSelect.Popup className={styles.popup}>
            {options.map((option) => (
              <BaseSelect.Item key={option.value} value={option.value} disabled={option.disabled} className={styles.item}>
                <BaseSelect.ItemText className={styles.itemText}>{option.label}</BaseSelect.ItemText>
                <BaseSelect.ItemIndicator className={styles.indicator} aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
