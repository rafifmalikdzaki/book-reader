import { useState } from 'react';

import type { ChatSource } from '../../../api/types';
import { SmartLink } from '../SmartLink';
import { bookHref, sourceLabel } from '../links';
import styles from './ContextCards.module.css';

/* Ported from beautiful-ui primitives/ContextCards.tsx (MIT, slev12397/beautiful-ui),
 * tidied compact variant: one row per citation — kind badge + linked label — with the
 * snippet as a single muted line underneath. Long lists collapse behind "show all". */

const COLLAPSE_AT = 5;

export interface ContextCardsProps {
  sources: ChatSource[];
  header?: string;
  className?: string;
}

function kindBadge(source: ChatSource): string {
  return source.kind === 'md' ? 'MD' : 'PDF';
}

export function ContextCards({ sources, header, className }: ContextCardsProps) {
  const [expanded, setExpanded] = useState(false);
  if (sources.length === 0) return null;
  const visible = expanded || sources.length <= COLLAPSE_AT ? sources : sources.slice(0, COLLAPSE_AT);
  return (
    <div className={`${styles.wrap}${className ? ` ${className}` : ''}`}>
      {header ? (
        <div className={styles.header}>
          <span className={styles.headerTitle}>{header}</span>
          <span className={styles.count}>{sources.length}</span>
        </div>
      ) : null}
      <ul className={styles.list}>
        {visible.map((source, i) => (
          <li key={`${i}-${bookHref(source)}`} className={styles.card} style={{ animationDelay: `${i * 60}ms` }}>
            <SmartLink href={bookHref(source)} className={styles.row} title={sourceLabel(source)}>
              <span className={styles.badge} aria-hidden="true">{kindBadge(source)}</span>
              <span className={styles.titleText}>{String(source.title || '') || sourceLabel(source)}</span>
              <svg className={styles.go} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 17L17 7M9 7h8v8" />
              </svg>
            </SmartLink>
            {source.snippet ? <p className={styles.snippet}>{source.snippet}</p> : null}
          </li>
        ))}
      </ul>
      {sources.length > COLLAPSE_AT ? (
        <button type="button" className={styles.more} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer' : `Show all ${sources.length} citations`}
        </button>
      ) : null}
    </div>
  );
}
