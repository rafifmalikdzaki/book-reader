import { useRef, useState } from 'react';

import { Button, Input, LinkButton } from '../../ui';
import styles from './Sidebar.module.css';

/** "+ Project" disclosure with an inline name form. */
export function ProjectCreate({ onCreate }: { onCreate: (name: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const field = useRef<HTMLInputElement>(null);

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    if (await onCreate(value)) {
      setName('');
      setOpen(false);
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
          value={name}
          maxLength={60}
          placeholder="Project name"
          aria-label="Project name"
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" size="sm">
          Add
        </Button>
        <LinkButton tone="muted" onClick={() => setOpen(false)}>
          Cancel
        </LinkButton>
      </form>
    </div>
  );
}
