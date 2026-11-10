import { useState } from 'react';

import type { ChatSource } from '../../../api/types';
import { SmartLink } from '../SmartLink';
import { bookHref, sourceLabel } from '../links';
import styles from './ContextCards.module.css';

/* Ported from beautiful-ui primitives/ContextCards.tsx (MIT, slev12397/beautiful-ui),
 * regrouped for citations: one card per book, its passages gathered under their section
 * as page/line chips. Twenty hits in one book read as one card, not twenty identical rows.
 * Long lists of books collapse behind "show all". */

const COLLAPSE_AT = 3;
/** Sections shown per book before the card folds the rest away. */
const SECTIONS_AT = 4;

export interface ContextCardsProps {
  sources: ChatSource[];
  header?: string;
  className?: string;
}

interface SectionGroup {
  section: string;
  sources: ChatSource[];
}

interface BookGroup {
  book: string;
  name: string;
  kind: 'PDF' | 'MD';
  count: number;
  sections: SectionGroup[];
}

function groupByBook(sources: ChatSource[]): BookGroup[] {
  const books = new Map<string, BookGroup>();
  for (const source of sources) {
    const book = String(source.book ?? '');
    let group = books.get(book);
    if (!group) {
      const title = typeof source.title === 'string' ? source.title : '';
      group = {
        book,
        name: title || (book.split('/').pop() ?? book),
        kind: source.kind === 'md' || /\.(md|markdown)$/i.test(book) ? 'MD' : 'PDF',
        count: 0,
        sections: [],
      };
      books.set(book, group);
    }
    const section = String(source.section ?? '');
    let bucket = group.sections.find((item) => item.section === section);
    if (!bucket) {
      bucket = { section, sources: [] };
      group.sections.push(bucket);
    }
    // The same passage is often retrieved by several tool calls; cite it once.
    const href = bookHref(source);
    if (bucket.sources.some((item) => bookHref(item) === href)) continue;
    bucket.sources.push(source);
    group.count += 1;
  }
  return [...books.values()];
}

/** Short locator on the chip; the full "file · p.12 · § Section" label stays the link's name. */
function chipText(source: ChatSource): string {
  if (source.page) return `p.${source.page}`;
  if (source.line) {
    const end = source.line_end && source.line_end !== source.line ? `–${source.line_end}` : '';
    return `lines ${source.line}${end}`;
  }
  return 'Open';
}

function SectionRow({ bucket }: { bucket: SectionGroup }) {
  const snippet = bucket.sources.find((item) => item.snippet)?.snippet;
  return (
    <li className={styles.section}>
      {bucket.section ? (
        <span className={styles.sectionName} title={bucket.section}>{bucket.section}</span>
      ) : null}
      <span className={styles.chips}>
        {bucket.sources.map((source) => {
          const label = sourceLabel(source);
          const named = typeof source.title === 'string' && source.title ? source.title : label;
          return (
            <SmartLink
              key={bookHref(source)}
              href={bookHref(source)}
              className={styles.chip}
              title={label}
              ariaLabel={named}
            >
              {chipText(source)}
            </SmartLink>
          );
        })}
      </span>
      {snippet ? <p className={styles.snippet}>{snippet}</p> : null}
    </li>
  );
}

function BookCard({ group, delay }: { group: BookGroup; delay: number }) {
  const [open, setOpen] = useState(false);
  const long = group.sections.length > SECTIONS_AT;
  const sections = open || !long ? group.sections : group.sections.slice(0, SECTIONS_AT);
  return (
    <li className={styles.card} style={{ animationDelay: `${delay}ms` }}>
      <div className={styles.bookHead}>
        <span className={styles.badge} aria-hidden="true">{group.kind}</span>
        <span className={styles.bookName} title={group.book}>{group.name}</span>
        {group.count > 1 ? <span className={styles.bookCount}>{group.count} passages</span> : null}
      </div>
      <ul className={styles.sections}>
        {sections.map((bucket) => (
          <SectionRow key={bucket.section} bucket={bucket} />
        ))}
      </ul>
      {long ? (
        <button
          type="button"
          className={styles.cardMore}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Show fewer sections' : `Show all ${group.sections.length} sections`}
        </button>
      ) : null}
    </li>
  );
}

export function ContextCards({ sources, header, className }: ContextCardsProps) {
  const [expanded, setExpanded] = useState(false);
  if (sources.length === 0) return null;
  const books = groupByBook(sources);
  const visible = expanded || books.length <= COLLAPSE_AT ? books : books.slice(0, COLLAPSE_AT);
  return (
    <div className={`${styles.wrap}${className ? ` ${className}` : ''}`}>
      {header ? (
        <div className={styles.header}>
          <span className={styles.headerTitle}>{header}</span>
          <span className={styles.count}>{sources.length}</span>
        </div>
      ) : null}
      <ul className={styles.list}>
        {visible.map((group, i) => (
          <BookCard key={group.book} group={group} delay={i * 60} />
        ))}
      </ul>
      {books.length > COLLAPSE_AT ? (
        <button type="button" className={styles.more} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer' : `Show all ${books.length} books`}
        </button>
      ) : null}
    </div>
  );
}
