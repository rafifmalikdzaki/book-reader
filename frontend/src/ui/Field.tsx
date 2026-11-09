import { useId, type ReactNode } from 'react';

import styles from './Field.module.css';
import { cx } from './cx';

/** Props to spread on the control inside a `<Field>`. */
export interface FieldControlProps {
  id: string;
  'aria-labelledby': string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

export interface FieldProps {
  label: ReactNode;
  /** Visually hide the label but keep it for assistive tech. */
  hideLabel?: boolean;
  hint?: ReactNode;
  /** Message shown in the danger colour; sets aria-invalid on the control. */
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Label + control + hint/error wiring. The control is a render prop so ids and
 * `aria-describedby` reach any element: `<Field label="Name">{(p) => <Input {...p} />}</Field>`.
 */
export function Field({ label, hideLabel, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx(styles.field, className)}>
      <label id={`${id}-label`} htmlFor={id} className={hideLabel ? styles.hidden : styles.label}>
        {label}
      </label>
      {children({
        id,
        'aria-labelledby': `${id}-label`,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
