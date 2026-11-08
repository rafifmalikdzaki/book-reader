import type { ChatProject, ChatSession } from '../../api/types';
import { Button, IconButton } from '../../ui';
import { ProjectCreate } from './ProjectCreate';
import { SessionGroups } from './SessionGroups';
import styles from './Sidebar.module.css';
import type { Drawer } from './useDrawer';

interface Props {
  drawer: Drawer;
  sessions: ChatSession[];
  projects: ChatProject[];
  currentId: string | null;
  loaded: boolean;
  locked: boolean;
  retentionDays: number | undefined;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onCreateProject: (name: string) => Promise<boolean>;
  onRemoveProject: (project: ChatProject) => void;
}

export function SessionsSidebar({ drawer: { open, isMobile, hide, attachClose }, locked, retentionDays, onNewChat, onSelect, onCreateProject, ...groups }: Props) {
  return (
    <aside
      id="ask-index"
      className={open ? `${styles.index} ${styles.open}` : styles.index}
      aria-label="Chat sessions"
      inert={isMobile && !open}
    >
      <div className={styles.head}>
        <p className={styles.label}>Chats</p>
        <IconButton ref={attachClose} label="Close chat list" icon="×" className={styles.close} onClick={hide} />
      </div>
      <Button className={styles.newChat} disabled={locked} onClick={onNewChat}>
        + New chat
      </Button>
      <ProjectCreate onCreate={onCreateProject} />
      <div className={styles.sessions} aria-live="polite">
        <SessionGroups {...groups} onSelect={(id) => !locked && onSelect(id)} onRemoveProject={(p) => !locked && groups.onRemoveProject(p)} />
      </div>
      {retentionDays !== undefined ? (
        <p className={styles.retention}>
          Chats are deleted after {retentionDays} days unless pinned or in a project.
        </p>
      ) : null}
    </aside>
  );
}
