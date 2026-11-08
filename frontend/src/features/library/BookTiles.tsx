import { Link } from 'react-router-dom';

import { thumbUrl } from '../../api/endpoints';
import type { LibraryBook, LibraryGroup } from '../../api/types';
import { ProgressBar } from '../../ui';
import { bookHref } from './bookLinks';
import styles from './BookTiles.module.css';

/** Thumbnails are requested at 300px wide; the 3:4 cover box reserves the space up front. */
const THUMB_WIDTH = 300;
const THUMB_HEIGHT = 400;

export function BookTiles({ groups }: { groups: LibraryGroup[] }) {
  return (
    <div className={styles.tiles} role="group" aria-label="Books">
      {groups.map((group) => (
        <section key={group.id} className={styles.group}>
          <div className={styles.groupHead}>
            <h3>{group.name}</h3>
            <span>{group.books.length}</span>
          </div>
          <div className={styles.grid}>
            {group.books.map((book) => (
              <Tile key={book.rel} book={book} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Tile({ book }: { book: LibraryBook }) {
  return (
    <Link className={styles.tile} to={bookHref(book.rel, book.page)}>
      <span className={styles.cover}>
        {book.kind === 'pdf' ? (
          <img
            src={thumbUrl(book.rel, THUMB_WIDTH)}
            width={THUMB_WIDTH}
            height={THUMB_HEIGHT}
            loading="lazy"
            decoding="async"
            alt=""
          />
        ) : (
          <span className={styles.md} aria-hidden="true">
            MD
          </span>
        )}
      </span>
      <span className={styles.title}>{book.title}</span>
      <span className={styles.meta}>
        {book.kind.toUpperCase()}
        {book.category_name ? ` · ${book.category_name}` : ''}
      </span>
      {book.percent ? (
        <ProgressBar
          size="thin"
          value={book.percent}
          label="Reading progress"
          valueText={`${book.percent}% read`}
          className={styles.progress}
        />
      ) : null}
      <span className={styles.meta}>{book.last_read_label}</span>
    </Link>
  );
}
