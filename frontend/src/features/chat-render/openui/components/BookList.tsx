import styles from '../OpenUI.module.css';
import { SmartLink } from '../../SmartLink';
import { bookHref } from '../../links';
import {
  citationToHref,
  type BookListBlock,
} from '../../openui';
import { RichSpan } from '../shared';

export function BookListView({
  spec,
  onPrompt,
}: {
  spec: BookListBlock;
  onPrompt?: (prompt: string) => void;
}) {
  return (
    <section className={styles.uiCard} aria-label={spec.title || 'Recommended books'}>
      <header className={styles.uiHeader}>
        <div>
          <span className={styles.uiEyebrow}>Library Recommendations</span>
          <h4 className={styles.uiTitle}>{spec.title || 'Recommended Reading'}</h4>
        </div>
      </header>
      <div className={styles.bookGrid}>
        {spec.books.map((item, idx) => {
          const href = item.book ? (citationToHref(item.book) ?? bookHref({ book: item.book })) : '';
          const cleanBook = item.book.split('#')[0] ?? '';
          const isPdf = cleanBook.toLowerCase().endsWith('.pdf');
          const displayTitle = item.title || cleanBook.split('/').pop() || 'Book';
          return (
            <article key={`${idx}-${item.book}`} className={styles.bookCard}>
              {isPdf && cleanBook ? (
                <img
                  src={`/thumb.jpg?path=${encodeURIComponent(cleanBook)}&width=140`}
                  alt=""
                  width={44}
                  height={60}
                  loading="lazy"
                  className={styles.bookThumb}
                />
              ) : null}
              <div className={styles.bookBody}>
                <div className={styles.bookTop}>
                  <strong className={styles.bookTitle}>{displayTitle}</strong>
                  {item.category ? <span className={styles.uiBadge}>{item.category}</span> : null}
                </div>
                <p className={styles.bookWhy}>
                  <RichSpan text={item.why} />
                </p>
                <div className={styles.bookFoot}>
                  {item.start ? <span className={styles.bookStart}>Start: {item.start}</span> : null}
                  <div className={styles.bookActions}>
                    {onPrompt && cleanBook ? (
                      <button
                        type="button"
                        className={styles.uiChipBtn}
                        onClick={() =>
                          onPrompt(`Show me the chapter outline of ${cleanBook}`)
                        }
                      >
                        Inspect outline
                      </button>
                    ) : null}
                    {href ? (
                      <SmartLink href={href} className={styles.uiCiteChip}>
                        Open book →
                      </SmartLink>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
