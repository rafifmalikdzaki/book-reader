import { useState } from 'react';

import type { ChatSource } from '../../api/types';
import { ContextCards } from '../chat-render/agent/ContextCards';
import { TaskRows, type TaskRowData } from '../chat-render/agent/TaskRows';
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

/** Live view of one agent run, built from the ported beautiful-ui primitives:
 * task rows for the tool steps, context cards for the passages they found. */
export function ProcessCard({ step, steps, found, thought, elapsed }: Props) {
  const [open, setOpen] = useState(false);
  const rows: TaskRowData[] = steps.map((text, idx) => ({
    key: String(idx),
    label: text,
    status: idx === steps.length - 1 ? 'running' : 'done',
    step: idx + 1,
  }));
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
          <span className={styles.processSubtitle}>{summary(steps.length, found.length)}</span>
        </span>
        {elapsed > 0 ? <span className={styles.processElapsed}>{elapsed.toFixed(1)}s</span> : null}
        <span className={styles.processChevron} data-open={open} aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      {open ? (
        <>
          {rows.length > 0 ? (
            <div role="list" aria-label="Steps taken">
              <TaskRows rows={rows} />
            </div>
          ) : null}
          {found.length > 0 ? (
            <div className={styles.processFound}>
              <div className={styles.processThoughtHeader}>Found in your library</div>
              <ContextCards sources={found} />
            </div>
          ) : null}
          {thought ? (
            <div className={styles.processThoughtStream}>
              <div className={styles.processThoughtHeader}>Model reasoning</div>
              <div className={styles.processThoughtBody}>{thought}</div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
