import { Link } from 'react-router-dom';

import type { LibraryBook } from '../../api/types';
import { bookHref } from './bookLinks';
import styles from './BookTable.module.css';

/** The list view: one row per book in server order. */
export function BookTable({ books }: { books: LibraryBook[] }) {
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
        {books.map((book) => (
          <tr key={book.rel}>
            <td className={styles.title}>
              <Link to={bookHref(book.rel, book.page)}>{book.title}</Link>
              <span className={styles.kind}>{book.kind.toUpperCase()}</span>
            </td>
            <td className={`${styles.shelf} ${styles.shelfCell}`}>{book.category_name}</td>
            <td className={`${styles.right} ${styles.pages}`}>{book.page_count ?? '—'}</td>
            <td className={`${styles.right} ${styles.opened}`}>{book.last_read_label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
