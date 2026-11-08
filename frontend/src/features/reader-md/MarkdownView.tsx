import { useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import type { MarkdownResponse } from '../../api/types';
import { Button, usePanel } from '../../ui';
import { MarkdownBody } from './MarkdownBody';
import styles from './MarkdownReader.module.css';
import { Outline } from './Outline';
import { parseLineHash } from './selection';
import { useActiveHeading } from './useActiveHeading';
import { useInternalLinks } from './useInternalLinks';
import { useLineDeepLink } from './useLineDeepLink';
import { useReadingProgress } from './useReadingProgress';
import { useSelectionNote } from './useSelectionNote';

/** A loaded document: outline rail, toolbar, injected HTML, mobile bar and note bubble. */
export function MarkdownView({ doc }: { doc: MarkdownResponse }) {
  const article = useRef<HTMLElement>(null);
  const outline = usePanel('contents');
  const { hash } = useLocation();
  // Only the hash the page opened with matters: a deep link beats the saved position.
  const [openedOnLine] = useState(() => parseLineHash(hash) !== null);
  const fileName = useMemo(() => doc.rel.split('/').pop() ?? doc.rel, [doc.rel]);

  const percent = useReadingProgress({
    path: doc.rel,
    restore: doc.progress.scroll,
    skipRestore: openedOnLine,
  });
  const current = useActiveHeading(article, doc.html);
  useLineDeepLink(article, doc.html);
  useInternalLinks(article);
  const { bubble, capture } = useSelectionNote(article, doc.rel);

  const label = `${percent}% read`;
  return (
    <>
      <Outline outline={doc.outline} current={current} />
      <div className={styles.toolbar}>
        <Button variant="ghost" className={styles.outlineButton} {...outline.toggleProps}>
          Outline
        </Button>
        <span className={styles.docPath}>{fileName}</span>
        <div className={styles.spacer} />
        <span className={styles.progress}>{label}</span>
      </div>
      <MarkdownBody ref={article} html={doc.html} />
      <div className={styles.mobileBar}>
        <span className={styles.progress}>{label}</span>
      </div>
      {bubble ? (
        <button
          type="button"
          className={styles.bubble}
          style={{ left: bubble.left, top: bubble.top }}
          onClick={capture}
        >
          + Note
        </button>
      ) : null}
    </>
  );
}
