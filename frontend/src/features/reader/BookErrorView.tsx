import { Link, useLocation } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { Button, buttonClassName, cx } from '../../ui';
import styles from './BookErrorView.module.css';

const HEADINGS: Record<number, string> = {
  400: "That address isn't a book",
  404: "We couldn't find that",
  500: 'Something broke',
};

const DETAILS: Record<number, string> = {
  400: 'The path points outside the library, or to a file this reader does not open.',
  404: 'That book is not in this library. It may have been moved or renamed.',
  500: 'The reader hit an error while opening this file.',
};

/** Same status and wording the legacy HTML error page used (app.py `http_error`). */
export function errorCopy(error: unknown): { status: number; heading: string; detail: string } {
  const status = error instanceof ApiError ? error.status : 500;
  const fallback = error instanceof Error ? error.message : 'Unknown error';
  return {
    status,
    heading: HEADINGS[status] ?? 'Something broke',
    detail: DETAILS[status] ?? fallback,
  };
}

/** Legacy `error.html`: heading, detail, `<status> · <path>`, and ways out. */
export function BookErrorView({ error }: { error: unknown }) {
  const { pathname } = useLocation();
  const { status, heading, detail } = errorCopy(error);
  return (
    <div className={cx(styles.panel, styles.plate)}>
      <h1 className={styles.heading}>{heading}</h1>
      <p className={styles.text}>{detail}</p>
      <p className={styles.detail}>
        {status} · {pathname}
      </p>
      <div className={styles.actions}>
        <Link className={buttonClassName('primary')} to="/">
          Back to the library
        </Link>
        <Button
          variant="ghost"
          onClick={() => document.getElementById('global-search')?.focus()}
        >
          Search the library
        </Button>
      </div>
    </div>
  );
}

/** Legacy `book_pdf.html` / `book_md.html` fallback for a file that exists but cannot be read. */
export function UnreadableBook({ kind, message }: { kind: 'pdf' | 'md'; message: string }) {
  return (
    <div className={styles.panel}>
      <h1 className={styles.heading}>
        {kind === 'pdf' ? 'This book wouldn’t open' : 'This document wouldn’t open'}
      </h1>
      <p className={styles.text}>{message}</p>
      <div className={styles.actions}>
        <Link className={buttonClassName('primary')} to="/">
          Back to the library
        </Link>
      </div>
    </div>
  );
}
