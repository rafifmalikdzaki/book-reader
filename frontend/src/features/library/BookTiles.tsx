import { Link } from 'react-router-dom';

import { thumbUrl } from '../../api/endpoints';
import type { LibraryBook, LibraryGroup } from '../../api/types';
import { ProgressBar } from '../../ui';
import { bookHref } from './bookLinks';
import styles from './BookTiles.module.css';
import { byline, type BookMeta } from './useBookMeta';

/** Thumbnails are requested at 300px wide; the 3:4 cover box reserves the space up front. */
const THUMB_WIDTH = 300;
const THUMB_HEIGHT = 400;

export interface BookTilesProps {
  groups: LibraryGroup[];
  metaFor?: (rel: string) => BookMeta;
}

export function BookTiles({ groups, metaFor }: BookTilesProps) {
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
              <Tile key={book.rel} book={book} groupName={group.name} meta={metaFor?.(book.rel)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Tile({
  book,
  groupName,
  meta,
}: {
  book: LibraryBook;
  groupName: string;
  meta?: BookMeta;
}) {
  const by = meta ? byline(meta) : '';
  // The group heading already names the category; repeat it only when it differs.
  const facts = [
    book.kind === 'md' ? 'Markdown' : 'PDF',
    ...(book.page_count ? [`${book.page_count} pp`] : []),
    ...(book.category_name && book.category_name !== groupName ? [book.category_name] : []),
  ];
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
        {book.percent ? (
          <ProgressBar
            size="thin"
            value={book.percent}
            label="Reading progress"
            valueText={`${book.percent}% read`}
            className={styles.progress}
          />
        ) : null}
      </span>
      <span className={styles.title}>{meta?.zotero?.title || book.title}</span>
      {by ? <span className={styles.by}>{by}</span> : null}
      <span className={styles.meta}>{facts.join(' · ')}</span>
      {book.last_read_at ? (
        <span className={styles.read}>
          {book.percent ? `${book.percent}% · ` : ''}
          {book.last_read_label}
        </span>
      ) : null}
    </Link>
  );
}
