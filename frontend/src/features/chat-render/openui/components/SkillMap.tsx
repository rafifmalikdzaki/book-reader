import styles from '../OpenUI.module.css';
import {
  type SkillMapBlock,
} from '../../legacyJson';
import { CitationChip, LEVEL_LABELS, MasteryRing, RichSpan, TUTOR_COMMANDS } from '../shared';

export function SkillMapView({
  spec,
  onPrompt,
}: {
  spec: SkillMapBlock;
  onPrompt?: (prompt: string) => void;
}) {
  const maxPossible = Math.max(1, spec.skills.length * 5);
  const earned = spec.skills.reduce((sum, item) => sum + item.level, 0);
  const pct = Math.round((earned / maxPossible) * 100);

  return (
    <section className={styles.uiCard} aria-label={`Skill Map: ${spec.topic}`}>
      <header className={styles.uiHeader}>
        <div>
          <span className={styles.uiEyebrow}>Socratic Skill Map · {pct}% Mastery</span>
          <h4 className={styles.uiTitle}>
            <RichSpan text={spec.topic} />
          </h4>
        </div>
        <div className={styles.uiHeaderRight}>
          <CitationChip cite={spec.book} />
          <MasteryRing pct={pct} />
        </div>
      </header>
      {spec.focus ? (
        <p className={styles.uiFocus}>
          <b>Current focus:</b> <RichSpan text={spec.focus} />
        </p>
      ) : null}
      <ul className={styles.skillList}>
        {spec.skills.map((skill, idx) => {
          const isFocus =
            skill.status === 'focus' ||
            (spec.focus && skill.name.toLowerCase().includes(spec.focus.toLowerCase()));
          return (
            <li
              key={`${idx}-${skill.name}`}
              className={isFocus ? `${styles.skillRow} ${styles.skillFocus}` : styles.skillRow}
            >
              <div className={styles.skillTop}>
                <span className={styles.skillName}>
                  <RichSpan text={skill.name} />
                  {skill.status ? (
                    <span className={styles.skillStatusBadge} data-status={skill.status}>
                      {skill.status}
                    </span>
                  ) : null}
                </span>
                <div className={styles.skillRight}>
                  <span className={styles.skillLevel}>
                    {LEVEL_LABELS[skill.level] ?? `${skill.level}/5`}
                  </span>
                  {onPrompt ? (
                    <button
                      type="button"
                      className={styles.skillPracticeBtn}
                      onClick={() => onPrompt(`Let's practice subskill: ${skill.name}`)}
                    >
                      Practice
                    </button>
                  ) : null}
                </div>
              </div>
              <div
                className={styles.skillTrack}
                role="progressbar"
                aria-valuenow={skill.level}
                aria-valuemin={0}
                aria-valuemax={5}
                aria-label={`${skill.name} mastery`}
              >
                <div className={styles.skillFill} style={{ width: `${(skill.level / 5) * 100}%` }} />
              </div>
              {skill.note ? (
                <p className={styles.skillNote}>
                  <RichSpan text={skill.note} />
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {onPrompt ? (
        <div className={styles.uiActions} role="group" aria-label="Socratic tutor controls">
          {TUTOR_COMMANDS.map((cmd) => (
            <button
              key={cmd.prompt}
              type="button"
              className={styles.uiChipBtn}
              onClick={() => onPrompt(cmd.prompt)}
            >
              {cmd.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
