import type { ReactNode } from 'react';

import type { ChatProject, ChatSession } from '../../api/types';
import { LinkButton } from '../../ui';
import { PulseDotIcon } from '../chat-render/icons';
import { updatedLabel } from './format';
import styles from './Sidebar.module.css';

interface GroupProps {
  label: string;
  count: number;
  onRemove?: () => void;
  children: ReactNode;
}

function Group({ label, count, onRemove, children }: GroupProps) {
  return (
    <section className={styles.group}>
      <div className={styles.groupHead}>
        <h2>{label}</h2>
        <span>{count}</span>
        {onRemove ? (
          <LinkButton tone="danger" className={styles.remove} aria-label={`Delete project ${label}`} onClick={onRemove}>
            ×
          </LinkButton>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function SessionButton({ session, current, onSelect }: {
  session: ChatSession;
  current: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={styles.session}
      aria-current={current ? 'true' : undefined}
      onClick={() => onSelect(session.id)}
    >
      <span className={styles.title}>{session.title || 'New chat'}</span>
      {session.status === 'thinking' ? (
        <span className={styles.thinkingBadge} aria-label="Thinking">
          <PulseDotIcon />
        </span>
      ) : null}
      {session.pinned ? <span className={styles.pin}>Pin</span> : null}
      <span className={styles.meta}>{updatedLabel(session.updated)}</span>
    </button>
  );
}

interface Props {
  sessions: ChatSession[];
  projects: ChatProject[];
  currentId: string | null;
  loaded: boolean;
  onSelect: (id: string) => void;
  onRemoveProject: (project: ChatProject) => void;
}

/** Pinned, one section per project, then Recent (ask.js `renderSessions`). */
export function SessionGroups({ sessions, projects, currentId, loaded, onSelect, onRemoveProject }: Props) {
  const pinned = sessions.filter((session) => session.pinned);
  const recent = sessions.filter((session) => !session.pinned && !session.project_id);
  const button = (session: ChatSession) => (
    <SessionButton key={session.id} session={session} current={session.id === currentId} onSelect={onSelect} />
  );
  return (
    <>
      {pinned.length ? (
        <Group label="Pinned" count={pinned.length}>
          {pinned.map(button)}
        </Group>
      ) : null}
      {projects.map((project) => {
        const all = sessions.filter((session) => session.project_id === project.id);
        const assigned = all.filter((session) => !session.pinned);
        return (
          <Group key={project.id} label={project.name} count={all.length} onRemove={() => onRemoveProject(project)}>
            {assigned.map(button)}
            {assigned.length ? null : (
              <p className={styles.projectEmpty}>
                {all.length
                  ? `${all.length} pinned chat${all.length === 1 ? '' : 's'} in Pinned.`
                  : 'No chats yet'}
              </p>
            )}
          </Group>
        );
      })}
      {recent.length ? (
        <Group label="Recent" count={recent.length}>
          {recent.map(button)}
        </Group>
      ) : null}
      {loaded && sessions.length === 0 ? (
        <p className={styles.sideEmpty}>No chats yet. Ask a question to start one.</p>
      ) : null}
    </>
  );
}
