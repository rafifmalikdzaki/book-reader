import styles from '../OpenUI.module.css';
import {
  type ConceptCardBlock,
} from '../../legacyJson';
import { CitationChip, RichSpan } from '../shared';

export function ConceptCardView({
  spec,
  onPrompt,
}: {
  spec: ConceptCardBlock;
  onPrompt?: (prompt: string) => void;
}) {
  return (
    <section className={styles.uiCard} aria-label={`Concept: ${spec.title}`}>
      <header className={styles.uiHeader}>
        <div>
          <span className={styles.uiEyebrow}>{spec.subtitle || 'Concept Breakdown'}</span>
          <h4 className={styles.uiTitle}>
            <RichSpan text={spec.title} />
          </h4>
        </div>
        <CitationChip cite={spec.book} />
      </header>
      <div className={styles.conceptGrid}>
        {spec.intuition ? (
          <div className={styles.conceptSection}>
            <span className={styles.conceptLabel}>Intuition</span>
            <p>
              <RichSpan text={spec.intuition} />
            </p>
          </div>
        ) : null}
        {spec.formal ? (
          <div className={styles.conceptSection}>
            <span className={styles.conceptLabel}>Formal Mechanism</span>
            <p>
              <RichSpan text={spec.formal} />
            </p>
          </div>
        ) : null}
        {spec.example ? (
          <div className={styles.conceptSection}>
            <span className={styles.conceptLabel}>Worked Example</span>
            <p>
              <RichSpan text={spec.example} />
            </p>
          </div>
        ) : null}
      </div>
      {spec.takeaways && spec.takeaways.length > 0 ? (
        <footer className={styles.conceptTakeaways}>
          <span className={styles.conceptLabel}>Key Takeaways</span>
          <ul>
            {spec.takeaways.map((point, idx) => (
              <li key={idx}>
                <RichSpan text={point} />
              </li>
            ))}
          </ul>
        </footer>
      ) : null}
      {onPrompt ? (
        <div className={styles.uiActions} role="group" aria-label="Concept follow-ups">
          <button
            type="button"
            className={styles.uiChipBtn}
            onClick={() => onPrompt(`Quiz me Socratically on ${spec.title}`)}
          >
            Quiz me on this
          </button>
          <button
            type="button"
            className={styles.uiChipBtn}
            onClick={() => onPrompt(`Walk me step-by-step through the derivation of ${spec.title}`)}
          >
            Derive step-by-step
          </button>
          <button
            type="button"
            className={styles.uiChipBtn}
            onClick={() =>
              onPrompt(`Map a ConceptGraph showing how ${spec.title} connects to related ideas`)
            }
          >
            Map concept graph
          </button>
        </div>
      ) : null}
    </section>
  );
}
