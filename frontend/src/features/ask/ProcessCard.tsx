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

/** Live view of one agent run: tool steps, the documents they found, and model reasoning. */
export function ProcessCard({ step, steps, found, thought, elapsed }: Props) {
  return (
    <div className={styles.processCard} role="status" aria-live="polite">
      <div className={styles.processHeader}>
        <span className={styles.processSpinner} aria-hidden="true" />
        <div className={styles.processHeaderTitle}>
          <strong>{step || 'Searching the library…'}</strong>
          <span className={styles.processSubtitle}>
            {steps.length > 0
              ? `${steps.length} step${steps.length === 1 ? '' : 's'}${
                  found.length > 0 ? ` · ${found.length} passage${found.length === 1 ? '' : 's'} found` : ''
                }`
              : 'Agent active'}
          </span>
        </div>
        {elapsed > 0 ? <span className={styles.processElapsed}>{elapsed.toFixed(1)}s</span> : null}
      </div>
      {steps.length > 0 ? (
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
      {found.length > 0 ? (
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
      {thought ? (
        <div className={styles.processThoughtStream}>
          <div className={styles.processThoughtHeader}>Model reasoning</div>
          <div className={styles.processThoughtBody}>{thought}</div>
        </div>
      ) : null}
    </div>
  );
}
