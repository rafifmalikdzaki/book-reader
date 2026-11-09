import { useState } from 'react';

import type { ChatSource } from '../../api/types';
import { SmartLink, bookHref, sourceLabel } from '../chat-render';
import styles from './AskPage.module.css';

interface Props {
  /** Latest step text, shown as the headline. */
  step?: string;
  steps: string[];
  found: ChatSource[];
  thought: string;
  elapsed: number;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

function summary(steps: number, found: number): string {
  if (steps === 0) return 'Agent active';
  return found > 0 ? `${count(steps, 'step')} · ${count(found, 'passage')} found` : count(steps, 'step');
}

/** Live view of one agent run: tool steps, the documents they found, and model reasoning. */
export function ProcessCard({ step, steps, found, thought, elapsed }: Props) {
  const [open, setOpen] = useState(true);
  return (
    <div className={styles.processCard} role="status" aria-live="polite">
      <button
        type="button"
        className={styles.processHeader}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.processSpinner} aria-hidden="true" />
        <span className={styles.processHeaderTitle}>
          <strong>{step || 'Searching the library…'}</strong>
          <span className={styles.processSubtitle}>
            {summary(steps.length, found.length)}
          </span>
        </span>
        {elapsed > 0 ? <span className={styles.processElapsed}>{elapsed.toFixed(1)}s</span> : null}
        <span className={styles.processChevron} data-open={open} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && steps.length > 0 ? (
        <ol className={styles.processSteps} aria-label="Steps taken">
          {steps.map((text, idx) => {
            const current = idx === steps.length - 1;
            return (
              <li key={idx} className={current ? styles.processStepCurrent : styles.processStepDone}>
                <span className={styles.processStepIcon} aria-hidden="true">
                  {current ? '●' : '✓'}
                </span>
                <span className={styles.processStepText}>{text}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {open && found.length > 0 ? (
        <div className={styles.processFound}>
          <div className={styles.processThoughtHeader}>Found in your library</div>
          <ul className={styles.processFoundList}>
            {found.map((source, idx) => (
              <li key={`${idx}-${bookHref(source)}`} className={styles.processFoundItem}>
                <SmartLink
                  href={bookHref(source)}
                  className={styles.processFoundLink}
                  title={sourceLabel(source)}
                >
                  {String(source.title || '') || sourceLabel(source)}
                </SmartLink>
                {source.snippet ? (
                  <span className={styles.processFoundSnippet}>{source.snippet}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {open && thought ? (
        <div className={styles.processThoughtStream}>
          <div className={styles.processThoughtHeader}>Model reasoning</div>
          <div className={styles.processThoughtBody}>{thought}</div>
        </div>
      ) : null}
    </div>
  );
}
