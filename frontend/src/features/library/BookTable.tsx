import { Link } from 'react-router-dom';

import type { LibraryBook } from '../../api/types';
import { bookHref } from './bookLinks';
import styles from './BookTable.module.css';
import { byline, type BookMeta } from './useBookMeta';

/** The list view: one row per book in server order. */
export interface BookTableProps {
  books: LibraryBook[];
  metaFor?: (rel: string) => BookMeta;
}

export function BookTable({ books, metaFor }: BookTableProps) {
  return (
    <table className={styles.books}>
      <colgroup>
        <col className={styles.colTitle} />
        <col className={styles.colShelf} />
        <col className={styles.colPages} />
        <col className={styles.colLast} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Title</th>
          <th scope="col" className={styles.shelf}>
            Category
          </th>
          <th scope="col" className={styles.right}>
            Pages
          </th>
          <th scope="col" className={`${styles.right} ${styles.lastHead}`}>
            Last read
          </th>
        </tr>
      </thead>
      <tbody>
        {books.map((book) => {
          const by = metaFor ? byline(metaFor(book.rel)) : '';
          return (
            <tr key={book.rel}>
              <td className={styles.title}>
                <Link to={bookHref(book.rel, book.page)}>{metaFor?.(book.rel).zotero?.title || book.title}</Link>
                <span className={styles.kind}>{book.kind.toUpperCase()}</span>
                {by ? <span className={styles.by}>{by}</span> : null}
              </td>
              <td className={`${styles.shelf} ${styles.shelfCell}`}>{book.category_name}</td>
              <td className={`${styles.right} ${styles.pages}`}>{book.page_count ?? '—'}</td>
              <td className={`${styles.right} ${styles.opened}`}>{book.last_read_label}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
