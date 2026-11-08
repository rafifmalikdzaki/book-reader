import type { ChatProject, ChatSession } from '../../api/types';
import { Button, IconButton, Select } from '../../ui';
import { subtitleText } from './format';
import styles from './AskPage.module.css';
import type { Drawer } from './useDrawer';

interface Props {
  drawer: Drawer;
  session: ChatSession | undefined;
  /** Book/page the draft chat is about (shown until a session exists). */
  draftBook: string | null;
  draftPage: number | null;
  projects: ChatProject[];
  locked: boolean;
  onTogglePin: () => void;
  onProject: (projectId: string) => void;
  onDelete: () => void;
}

export function AskHeader({ drawer: { open, show, attachMenu }, session, draftBook, draftPage, projects, locked, onTogglePin, onProject, onDelete }: Props) {
  const off = locked || !session;
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
        <h1>{session?.title || 'New chat'}</h1>
        <p>{subtitleText(session?.book ?? draftBook, session?.page ?? draftPage)}</p>
      </div>
      <div className={styles.actions}>
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
