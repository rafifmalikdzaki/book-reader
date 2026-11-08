import { memo, type Ref } from 'react';

import styles from './MarkdownBody.module.css';

interface Props {
  html: string;
  ref: Ref<HTMLElement>;
}

/**
 * The single place server HTML enters the DOM. Safe because `mdrender.py` renders with
 * markdown-it "commonmark" and `html: False` (raw HTML in the source is escaped, never
 * passed through), rewrites relative links to library routes, and Pygments only emits
 * classed spans. Memoised so React never re-writes the subtree (which would drop the
 * user's selection and scroll anchors) when reading state around it changes.
 */
export const MarkdownBody = memo(function MarkdownBody({ html, ref }: Props) {
  return <article ref={ref} className={styles.doc} dangerouslySetInnerHTML={{ __html: html }} />;
});
