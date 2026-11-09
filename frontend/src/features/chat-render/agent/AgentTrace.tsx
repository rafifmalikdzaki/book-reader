import { useState, type ReactNode } from 'react';

import { CheckIcon, ChevronDownIcon } from '../icons';
import styles from './AgentTrace.module.css';

/* Ported from beautiful-ui primitives/ThinkingState.tsx (MIT, slev12397/beautiful-ui).
 * Live-data driven instead of demo-sequenced: the trace expands while the agent
 * works, settles to a collapsed "done" header, and stays expandable. */

export interface TraceRow {
  text: string;
  meta?: string;
  mono?: boolean;
}

interface Props {
  working: boolean;
  /** Header text while working, e.g. "Searching the library…". */
  active: string;
  /** Header text once settled, e.g. "Thought for 4 seconds". */
  done: string;
  rows: TraceRow[];
  query?: string;
  defaultOpen?: boolean;
  icon?: ReactNode;
}

export function AgentTrace({ working, active, done, rows, query, defaultOpen = false, icon }: Props) {
  const [manual, setManual] = useState<boolean | null>(null);
  const expanded = manual ?? (working || defaultOpen);

  return (
    <div className={styles.trace} aria-live="polite">
      <button
        type="button"
        className={styles.header}
        aria-expanded={expanded}
        onClick={() => setManual(!expanded)}
      >
        <span className={styles.spark} data-working={working}>
          {icon ?? (
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
            </svg>
          )}
        </span>
        {working ? <span className={styles.shimmer}>{active}</span> : <span className={styles.done}>{done}</span>}
        <span className={styles.chevron} data-open={expanded} aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>
      <div className={styles.body} data-open={expanded}>
        <div className={styles.bodyClip}>
          <div className={styles.rows}>
            {query ? (
              <div className={styles.query}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" />
                </svg>
                <span>{query}</span>
              </div>
            ) : null}
            <ol className={styles.list} aria-label="Steps taken">
              {rows.map((row, i) => {
                const isCurrent = working && i === rows.length - 1;
                return (
                  <li key={i} className={styles.row} style={{ animationDelay: `${i * 120}ms` }}>
                    {isCurrent ? (
                      <span className={styles.spinner} aria-hidden="true" />
                    ) : (
                      <span className={styles.check} aria-hidden="true">
                        <CheckIcon />
                      </span>
                    )}
                    <span className={styles.rowText}>{row.text}</span>
                    {row.meta ? (
                      <span className={`${styles.rowMeta} ${row.mono ? styles.mono : ''}`}>{row.meta}</span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
