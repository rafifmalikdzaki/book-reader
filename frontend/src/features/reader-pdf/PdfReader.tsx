import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import type { BookDetail } from '../../api/types';
import { useStage } from '../../app';
import { buttonClassName, cx } from '../../ui';
import { initialPage, viewerSrcForPage } from './bridgeMath';
import styles from './PdfReader.module.css';
import { usePdfBridge } from './usePdfBridge';

export interface PdfReaderProps {
  /** Non-redirect `getBook` response with kind === 'pdf'. */
  book: BookDetail;
}

function rawHref(rel: string): string {
  return '/raw/' + rel.split('/').map(encodeURIComponent).join('/');
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className={styles.errorPanel}>
      <h1>This book wouldn’t open</h1>
      <p>{message}</p>
      <Link className={buttonClassName()} to="/">
        Back to the library
      </Link>
    </div>
  );
}

/**
 * The iframe is created once per book: `src` and the first page are frozen at mount, so a
 * refetch (new `#page=` in `viewer_url`) or a hash change never navigates or remounts it.
 */
function PdfSurface({ book }: PdfReaderProps) {
  const { hash } = useLocation();
  const [firstPage] = useState(book.page);
  // A `#p<n>` the page opened with beats the server's page; PDF.js must start there itself.
  const [src] = useState(() =>
    book.viewer_url ? viewerSrcForPage(book.viewer_url, initialPage(hash, book.page)) : null,
  );
  const frameRef = useRef<HTMLIFrameElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const { fallback, bubble, addNote } = usePdfBridge({
    rel: book.rel,
    firstPage,
    frameRef,
    shellRef,
    bubbleRef,
  });

  return (
    <>
      <div ref={shellRef} className={styles.shell} id="pdf-shell">
        <iframe
          ref={frameRef}
          id="pdf-frame"
          className={cx(styles.frame, fallback && styles.frameHidden)}
          title={book.title}
          src={src ?? undefined}
          data-book={book.rel}
          data-page={firstPage ?? undefined}
          allow="fullscreen"
        />
        {fallback ? (
          <div className={styles.fallback} id="pdf-fallback">
            <p>The native PDF viewer could not start in this browser.</p>
            <a className={buttonClassName()} href={rawHref(book.rel)} target="_blank" rel="noreferrer">
              Open PDF
            </a>
          </div>
        ) : null}
      </div>
      <button
        ref={bubbleRef}
        id="note-capture"
        type="button"
        className={styles.bubble}
        hidden={!bubble}
        style={bubble ? { left: bubble.left, top: bubble.top } : undefined}
        onClick={addNote}
      >
        + Note
      </button>
    </>
  );
}

export function PdfReader({ book }: PdfReaderProps) {
  useStage('pdf');
  if (book.error || !book.viewer_url) {
    return <ErrorPanel message={book.error ?? 'The PDF viewer is unavailable for this file.'} />;
  }
  return <PdfSurface key={book.rel} book={book} />;
}
