import { Link } from 'react-router-dom';

import type { LibraryCard, NotePreview } from '../../api/types';
import { bookHref } from './bookLinks';
import styles from './IndexSide.module.css';
import { SectionLabel } from './SectionLabel';

export interface IndexSideProps {
  hasResume: boolean;
  notes: NotePreview[];
  recent: LibraryCard[];
  bookCount: number;
}

/** Right-hand column of the index: resume notes, recently opened books, book count. */
export function IndexSide({ hasResume, notes, recent, bookCount }: IndexSideProps) {
  return (
    <aside className={styles.side} aria-label="Notes and recent books">
      <section>
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
      {recent.length > 0 ? (
        <section>
          <SectionLabel>Recently opened</SectionLabel>
          <ul className={styles.list}>
            {recent.map((item) => (
              <li key={item.rel} className={styles.recent}>
                <Link className={styles.recentTitle} to={bookHref(item.rel, item.page)}>
                  {item.title}
                </Link>
                <span className={styles.percent}>{item.percent}%</span>
                <span className={styles.recentMeta}>
                  {item.page ? `p.${item.page}` : ''}
                  {item.section ? ` · § ${item.section}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className={styles.foot}>{bookCount} books · local library</p>
    </aside>
  );
}
