import { useState } from 'react';

import styles from '../OpenUI.module.css';
import {
  type QuizCheckBlock,
} from '../../openui';
import { RichSpan } from '../shared';

export function QuizCheckView({
  spec,
  onPrompt,
}: {
  spec: QuizCheckBlock;
  onPrompt?: (prompt: string) => void;
}) {
  const [showHint, setShowHint] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  return (
    <section className={styles.uiCard} aria-label="Check your understanding">
      <header className={styles.uiHeader}>
        <div>
          <span className={styles.uiEyebrow}>Socratic Check</span>
          <h4 className={styles.uiTitle}>
            <RichSpan text={spec.question} />
          </h4>
        </div>
        {spec.hint ? (
          <button
            type="button"
            className={styles.uiChipBtn}
            aria-expanded={showHint}
            onClick={() => setShowHint((prev) => !prev)}
          >
            {showHint ? 'Hide hint' : 'Need a hint?'}
          </button>
        ) : null}
      </header>
      {showHint && spec.hint ? (
        <p className={styles.uiHint}>
          <b>Hint:</b> <RichSpan text={spec.hint} />
        </p>
      ) : null}
      {spec.options && spec.options.length > 0 && onPrompt ? (
        <div className={styles.uiActions} role="group" aria-label="Answer options">
          {spec.options.map((opt, idx) => {
            const isChosen = selectedOption === opt;
            return (
              <button
                key={idx}
                type="button"
                aria-pressed={isChosen}
                className={isChosen ? `${styles.uiChipBtn} ${styles.uiChipBtnActive}` : styles.uiChipBtn}
                onClick={() => {
                  setSelectedOption(opt);
                  onPrompt(opt);
                }}
              >
                <RichSpan text={opt} />
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
