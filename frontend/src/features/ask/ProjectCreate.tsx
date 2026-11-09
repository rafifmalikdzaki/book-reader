import { useRef, useState } from 'react';

import { Button, Input, LinkButton } from '../../ui';
import styles from './Sidebar.module.css';

/** "+ Project" disclosure with an inline name form. */
export function ProjectCreate({ onCreate }: { onCreate: (name: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    const value = name.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    try {
      if (await onCreate(value)) {
        setName('');
        setOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.projectCreate}>
      <LinkButton
        onClick={() => {
          setOpen(!open);
          if (!open) requestAnimationFrame(() => field.current?.focus());
        }}
      >
        + Project
      </LinkButton>
      <form hidden={!open} autoComplete="off" onSubmit={submit}>
        <Input
          ref={field}
          name="projectName"
          value={name}
          maxLength={60}
          placeholder="Project name…"
          aria-label="Project name"
          disabled={submitting}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" size="sm" loading={submitting} disabled={submitting || !name.trim()}>
          Add
        </Button>
        <LinkButton tone="muted" disabled={submitting} onClick={() => setOpen(false)}>
          Cancel
        </LinkButton>
      </form>
    </div>
  );
}
