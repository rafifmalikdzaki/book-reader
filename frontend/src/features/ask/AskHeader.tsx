import { useEffect, useRef, useState } from 'react';

import type { ChatProject, ChatSession } from '../../api/types';
import { Button, IconButton, Select } from '../../ui';
import { subtitleText } from './format';
import styles from './AskPage.module.css';
import type { Drawer } from './useDrawer';

/** Mirrors the server's title limit (`MAX_TITLE` in chat/sessions.py). */
const MAX_TITLE = 80;

interface Props {
  drawer: Drawer;
  session: ChatSession | undefined;
  /** Book/page the draft chat is about (shown until a session exists). */
  draftBook: string | null;
  draftPage: number | null;
  projects: ChatProject[];
  locked: boolean;
  onTogglePin: () => void;
  onRename: (title: string) => void;
  onProject: (projectId: string) => void;
  onDelete: () => void;
}

export function AskHeader({ drawer: { open, show, attachMenu }, session, draftBook, draftPage, projects, locked, onTogglePin, onRename, onProject, onDelete }: Props) {
  const off = locked || !session;
  // Tied to a session id so switching chats drops a half-typed title.
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const settled = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const editing = session !== undefined && draft?.id === session.id;
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const next = draft?.text.trim() ?? '';
    setDraft(null);
    if (save && session && next && next !== session.title) onRename(next);
  };
  const projectId = projects.some((project) => project.id === session?.project_id) ? (session?.project_id ?? '') : '';
  return (
    <header className={styles.head}>
      <IconButton
        ref={attachMenu}
        tone="outline"
        label="Open chat list"
        icon="☰"
        className={styles.menu}
        aria-controls="ask-index"
        aria-expanded={open}
        onClick={show}
      />
      <div className={styles.titleWrap}>
        {editing && draft ? (
          <input
            className={styles.titleInput}
            aria-label="Chat title"
            value={draft.text}
            maxLength={MAX_TITLE}
            ref={input}
            onChange={(event) => setDraft({ id: draft.id, text: event.target.value })}
            onBlur={() => finish(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') finish(true);
              if (event.key === 'Escape') finish(false);
            }}
          />
        ) : (
          <h1>{session?.title || 'New chat'}</h1>
        )}
        <p>{subtitleText(session?.book ?? draftBook, session?.page ?? draftPage)}</p>
      </div>
      <div className={styles.actions}>
        <Button
          variant="ghost"
          size="sm"
          disabled={!session || editing}
          onClick={() => {
            if (!session) return;
            settled.current = false;
            setDraft({ id: session.id, text: session.title });
          }}
        >
          Rename
        </Button>
        <Button variant="ghost" size="sm" aria-pressed={Boolean(session?.pinned)} disabled={off} onClick={onTogglePin}>
          {session?.pinned ? 'Pinned' : 'Pin'}
        </Button>
        <Select aria-label="Chat project" value={projectId} disabled={off} onChange={(event) => onProject(event.target.value)}>
          <option value="">No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
        <Button variant="ghost" size="sm" disabled={off} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </header>
  );
}
