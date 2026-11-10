import { Link } from 'react-router-dom';

import { thumbUrl } from '../../api/endpoints';
import type { LibraryCard } from '../../api/types';
import { ProgressBar, buttonClassName } from '../../ui';
import { bookHref } from './bookLinks';
import styles from './ResumeCard.module.css';
import { SectionLabel } from './SectionLabel';
import { byline, type BookMeta } from './useBookMeta';

export interface ResumeCardProps {
  resume: LibraryCard | null;
  /** Authors, year and Zotero link for the resume book, when known. */
  meta?: BookMeta;
}

/** "Continue reading": the most recently read book, or an empty plate when none was opened. */
export function ResumeCard({ resume, meta }: ResumeCardProps) {
  return (
    <section aria-labelledby="resume-heading">
      <SectionLabel>Continue reading</SectionLabel>
      {resume ? <Plate resume={resume} meta={meta} /> : <EmptyPlate />}
    </section>
  );
}

function Plate({ resume, meta }: { resume: LibraryCard; meta?: BookMeta }) {
  const href = bookHref(resume.rel, resume.page);
  const where = [
    resume.kind === 'md' ? 'Markdown' : 'PDF',
    ...(resume.section ? [`§ ${resume.section}`] : []),
    resume.shelf,
  ].join(' · ');
  const by = meta ? byline(meta) : '';
  return (
    <article className={styles.plate}>
      {resume.kind === 'pdf' ? (
        <Link className={styles.cover} to={href} tabIndex={-1} aria-hidden="true">
          <img src={thumbUrl(resume.rel, 300)} width={300} height={400} decoding="async" alt="" />
        </Link>
      ) : null}
      <div className={styles.body}>
        <h2 id="resume-heading" className={styles.title}>
          <Link to={href}>{resume.title}</Link>
        </h2>
        {by ? <p className={styles.by}>{by}</p> : null}
        <p className={styles.where}>{where}</p>
        <ProgressBar
          value={resume.percent}
          label="Reading progress"
          valueText={`${resume.percent}% read`}
          className={styles.progress}
        />
        <div className={styles.meta}>
          <span>
            {resume.page
              ? `Page ${resume.page} of ${resume.page_count ?? '—'}`
              : `Scroll position ${resume.percent}%`}
          </span>
          <span>{resume.updated_label}</span>
        </div>
        <div className={styles.actions}>
          <Link className={buttonClassName()} to={href}>
            {resume.page ? `Resume page ${resume.page}` : 'Resume reading'}
          </Link>
          {meta?.zotero ? (
            <a className={styles.zotero} href={meta.zotero.select_uri}>
              Open in Zotero
            </a>
          ) : null}
          <span className={styles.shelfPath} title={resume.rel}>
            Shelf · {resume.rel}
          </span>
        </div>
      </div>
    </article>
  );
}

function EmptyPlate() {
  return (
    <article className={styles.plate}>
      <div className={styles.body}>
        <h2 id="resume-heading" className={`${styles.title} ${styles.emptyTitle}`}>
          Nothing open yet
        </h2>
        <p className={styles.where}>Pick a book below; your page will be waiting here next time.</p>
        <a className={buttonClassName()} href="#library">
          Browse the library
        </a>
      </div>
    </article>
  );
}
