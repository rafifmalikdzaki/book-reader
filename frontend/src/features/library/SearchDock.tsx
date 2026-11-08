import { Link } from 'react-router-dom';

import type { SearchHit, SearchResponse } from '../../api/types';
import { LinkButton, cx } from '../../ui';
import { bookHref } from './bookLinks';
import styles from './SearchDock.module.css';
import { highlight } from './highlight';

export interface SearchDockProps {
  term: string;
  loading: boolean;
  errorMessage: string;
  data: SearchResponse | undefined;
  onClose: () => void;
}

function locator(hit: SearchHit): string {
  const parts: string[] = [];
  if (hit.page) parts.push(`p.${hit.page}`);
  else if (hit.line) parts.push(`L${hit.line}`);
  if (hit.section) parts.push(`§ ${hit.section}`);
  return parts.join(' · ');
}

function title(props: SearchDockProps): string {
  if (props.errorMessage) return 'Search failed';
  if (props.loading || !props.data) return `Searching “${props.term}”…`;
  const count = props.data.hits.length;
  return `${count} result${count === 1 ? '' : 's'} inside books`;
}

/** Full-text results above the library (legacy `#library-dock`). */
export function SearchDock(props: SearchDockProps) {
  const { term, errorMessage, data, onClose } = props;
  const hits = data?.hits ?? [];
  const failed = errorMessage !== '';
  return (
    <div className={cx(styles.dock, failed && styles.failed)}>
      <div className={styles.head}>
        <strong>{title(props)}</strong>
        <span className={styles.meta}>{failed ? '' : (data?.backend ?? '')}</span>
        <LinkButton tone="muted" className={styles.close} onClick={onClose}>
          Close
        </LinkButton>
      </div>
      {hits.length > 0 ? (
        <ol className={styles.results}>
          {hits.map((hit, index) => (
            <li key={`${hit.book}-${hit.page ?? hit.line ?? ''}-${index}`}>
              <Link className={styles.where} to={bookHref(hit.book, hit.page, hit.line)}>
                {`${hit.book.split('/').pop()} · ${locator(hit)}`}
              </Link>
              <span className={styles.snippet}>{highlight(hit.snippet, term)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {failed ? <p className={styles.empty}>{errorMessage}</p> : null}
      {!failed && data && hits.length === 0 ? (
        <p className={styles.empty}>No matches in the library.</p>
      ) : null}
    </div>
  );
}
