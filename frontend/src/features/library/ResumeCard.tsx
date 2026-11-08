import { Link } from 'react-router-dom';

import type { LibraryCard } from '../../api/types';
import { ProgressBar, buttonClassName } from '../../ui';
import { bookHref } from './bookLinks';
import styles from './ResumeCard.module.css';
import { SectionLabel } from './SectionLabel';

/** "Continue reading": the most recently read book, or an empty plate when none was opened. */
export function ResumeCard({ resume }: { resume: LibraryCard | null }) {
  return (
    <section aria-labelledby="resume-heading">
      <SectionLabel>Continue reading</SectionLabel>
      {resume ? <Plate resume={resume} /> : <EmptyPlate />}
    </section>
  );
}

function Plate({ resume }: { resume: LibraryCard }) {
  const href = bookHref(resume.rel, resume.page);
  const where = [
    resume.kind === 'md' ? 'Markdown' : 'PDF',
    ...(resume.section ? [`§ ${resume.section}`] : []),
    resume.shelf,
  ].join(' · ');
  return (
    <article className={styles.plate}>
      <h1 id="resume-heading" className={styles.title}>
        <Link to={href}>{resume.title}</Link>
      </h1>
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
        <span className={styles.shelfPath} title={resume.rel}>
          Shelf · {resume.rel}
        </span>
      </div>
    </article>
  );
}

function EmptyPlate() {
  return (
    <article className={styles.plate}>
      <h1 id="resume-heading" className={`${styles.title} ${styles.emptyTitle}`}>
        Nothing open yet
      </h1>
      <p className={styles.where}>Pick a book below; your page will be waiting here next time.</p>
      <a className={buttonClassName()} href="#library">
        Browse the library
      </a>
    </article>
  );
}
