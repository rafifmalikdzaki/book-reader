import type { ChatSource } from '../../api/types';

import styles from './ChatRender.module.css';
import { SmartLink } from './SmartLink';
import { bookHref, sourceLabel } from './links';

/** Citation links back into the reader (`book.pdf#p12`, `notes.md#L40`). */
export function SourceList({ sources }: { sources: ChatSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className={styles.sources}>
      {sources.map((source, index) => (
        <SmartLink
          key={`${index}-${bookHref(source)}`}
          href={bookHref(source)}
          title={sourceLabel(source)}
        >
          {sourceLabel(source)}
        </SmartLink>
      ))}
    </div>
  );
}
