import type { MouseEvent } from 'react';

import type { MarkdownOutlineEntry } from '../../api/types';
import { cx, MOBILE_QUERY, Rail, RailBody, usePanel } from '../../ui';
import { ContentsPortal } from '../../app';
import styles from './Outline.module.css';

interface Props {
  outline: MarkdownOutlineEntry[];
  /** Source line of the heading being read. */
  current: number | null;
}

/** The Markdown outline rail (legacy `#contents`), docked left of the document. */
export function Outline({ outline, current }: Props) {
  const panel = usePanel('contents');

  const jump = (event: MouseEvent<HTMLAnchorElement>, line: number) => {
    event.preventDefault();
    document.getElementById(`L${line}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (window.matchMedia?.(MOBILE_QUERY).matches) panel.hide();
  };

  return (
    <ContentsPortal>
      <Rail {...panel.railProps} side="left" label="Outline" title="Outline">
        <RailBody>
          {outline.length > 0 ? (
            <ol className={styles.route}>
              {outline.map((entry) => (
                <li
                  key={entry.line}
                  className={cx(
                    styles.item,
                    entry.level === 2 && styles.level2,
                    entry.level === 3 && styles.level3,
                    entry.line === current && styles.current,
                  )}
                >
                  <a
                    className={styles.link}
                    href={`#L${entry.line}`}
                    aria-current={entry.line === current ? 'location' : undefined}
                    onClick={(event) => jump(event, entry.line)}
                  >
                    <span className={styles.title}>{entry.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.empty}>No headings in this document.</p>
          )}
        </RailBody>
      </Rail>
    </ContentsPortal>
  );
}
