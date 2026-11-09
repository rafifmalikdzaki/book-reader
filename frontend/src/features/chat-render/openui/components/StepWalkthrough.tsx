import styles from '../OpenUI.module.css';
import { MathText } from '../../MathText';
import {
  type StepWalkthroughBlock,
} from '../../legacyJson';
import { CitationChip, RichSpan } from '../shared';

export function StepWalkthroughView({
  spec,
  onPrompt,
}: {
  spec: StepWalkthroughBlock;
  onPrompt?: (prompt: string) => void;
}) {
  return (
    <section className={styles.uiCard} aria-label={spec.title}>
      <header className={styles.uiHeader}>
        <div>
          <span className={styles.uiEyebrow}>Guided Walkthrough · {spec.steps.length} Steps</span>
          <h4 className={styles.uiTitle}>
            <RichSpan text={spec.title} />
          </h4>
        </div>
      </header>
      <ol className={styles.stepList}>
        {spec.steps.map((step, idx) => (
          <li key={idx} className={styles.stepItem}>
            <span className={styles.stepIndex} aria-hidden="true">
              {idx + 1}
            </span>
            <div className={styles.stepBody}>
              <div className={styles.stepHead}>
                <strong>
                  <RichSpan text={step.title} />
                </strong>
                <div className={styles.stepMeta}>
                  <CitationChip cite={step.cite} />
                  {onPrompt ? (
                    <button
                      type="button"
                      className={styles.stepAskBtn}
                      onClick={() =>
                        onPrompt(
                          `Explain Step ${idx + 1} (${step.title}) of ${spec.title} in deeper detail`,
                        )
                      }
                    >
                      Unpack step
                    </button>
                  ) : null}
                </div>
              </div>
              {step.detail ? (
                <p>
                  <RichSpan text={step.detail} />
                </p>
              ) : null}
              {step.formula ? (
                <div className={styles.stepFormula}>
                  <MathText
                    text={step.formula.startsWith('$') ? step.formula : `$$${step.formula}$$`}
                  />
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
