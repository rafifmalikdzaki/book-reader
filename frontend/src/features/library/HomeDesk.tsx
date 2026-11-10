import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { listChatSessions, thumbUrl } from '../../api/endpoints';
import type { LibraryCard, NotePreview } from '../../api/types';
import { SESSIONS_KEY } from '../ask/keys';
import { updatedLabel } from '../ask/format';
import { bookHref } from './bookLinks';
import styles from './Home.module.css';
import { SectionLabel } from './SectionLabel';

const CHATS_SHOWN = 4;

/** Recently opened books beside the resume card, each with its cover. */
export function RecentBooks({ recent }: { recent: LibraryCard[] }) {
  if (recent.length === 0) return null;
  return (
    <section aria-label="Recently opened">
      <SectionLabel>Recently opened</SectionLabel>
      <ul className={styles.list}>
        {recent.map((item) => (
          <li key={item.rel} className={styles.recent}>
            <span className={styles.recentCover} aria-hidden="true">
              {item.kind === 'pdf' ? (
                <img src={thumbUrl(item.rel, 120)} width={120} height={160} loading="lazy" decoding="async" alt="" />
              ) : (
                <span className={styles.recentMd}>MD</span>
              )}
            </span>
            <span className={styles.recentBody}>
              <Link className={styles.recentTitle} to={bookHref(item.rel, item.page)}>
                {item.title}
              </Link>
              <span className={styles.recentMeta}>
                {item.page ? `p.${item.page}` : ''}
                {item.section ? ` · § ${item.section}` : ''}
              </span>
            </span>
            <span className={styles.percent}>{item.percent}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Passages kept from the book being read. */
export function ResumeNotes({ hasResume, notes }: { hasResume: boolean; notes: NotePreview[] }) {
  return (
    <section aria-label="Notes">
      <SectionLabel>{hasResume ? 'Notes from this book' : 'Notes'}</SectionLabel>
      {notes.length > 0 ? (
        <ul className={styles.list}>
          {notes.map((note, index) => (
            <li key={`${note.book}-${index}`} className={styles.quote}>
              <Link to={bookHref(note.book, note.page, note.line_start)}>{note.quote}</Link>
              <span className={styles.locator}>{note.locator}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>Select text in a book to keep a passage here.</p>
      )}
    </section>
  );
}

/** The latest Ask conversations; hidden when chat sessions cannot be listed. */
export function RecentChats() {
  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => listChatSessions(),
    retry: false,
  });
  if (!sessions.data) return null;
  const latest = [...sessions.data.sessions]
    .sort((a, b) => b.updated - a.updated)
    .slice(0, CHATS_SHOWN);
  return (
    <section aria-label="Recent chats">
      <SectionLabel>Recent chats</SectionLabel>
      {latest.length > 0 ? (
        <ul className={styles.list}>
          {latest.map((chat) => (
            <li key={chat.id} className={styles.chat}>
              <Link className={styles.chatTitle} to={`/ask?chat=${encodeURIComponent(chat.id)}`}>
                {chat.title || 'Untitled chat'}
              </Link>
              <span className={styles.chatAge}>{updatedLabel(chat.updated)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>Questions you ask about your books are kept here.</p>
      )}
    </section>
  );
}
