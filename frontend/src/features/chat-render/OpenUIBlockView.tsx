import { useState } from 'react';

import styles from './ChatRender.module.css';
import { MATH_HINT, MathText } from './MathText';
import { SmartLink } from './SmartLink';
import { bookHref } from './links';
import {
  citationToHref,
  parseOpenUIBlock,
  type BookListBlock,
  type ComparisonTableBlock,
  type ConceptCardBlock,
  type QuizCheckBlock,
  type SkillMapBlock,
  type StepWalkthroughBlock,
} from './openui';

const LEVEL_LABELS: Record<number, string> = {
  0: '0 · Unaware',
  1: '1 · Heard of it',
  2: '2 · Follow along',
  3: '3 · With help',
  4: '4 · Independent',
  5: '5 · Can teach',
};

const TUTOR_COMMANDS = [
  { label: 'Show progress', prompt: 'show progress' },
  { label: 'Easier', prompt: 'easier' },
  { label: 'Harder', prompt: 'harder' },
  { label: 'Just tell me', prompt: 'just tell me' },
  { label: 'Save state', prompt: 'save state' },
] as const;

function RichSpan({ text }: { text: string }) {
  return MATH_HINT.test(text) ? <MathText text={text} /> : <>{text}</>;
}

function CitationChip({ cite }: { cite?: string }) {
  if (!cite) return null;
  const href = citationToHref(cite);
  const shortLabel = cite.split('/').pop() ?? cite;
  if (!href) {
    return <span className={styles.uiBadge}>{shortLabel}</span>;
  }
  return (
    <SmartLink href={href} className={styles.uiCiteChip}>
      {shortLabel}
    </SmartLink>
  );
}

function SkillMapView({
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
          <h4 className={styles.uiTitle}>{spec.topic}</h4>
        </div>
        <CitationChip cite={spec.book} />
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
                </span>
                <span className={styles.skillLevel}>{LEVEL_LABELS[skill.level] ?? `${skill.level}/5`}</span>
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
              {skill.note ? <p className={styles.skillNote}>{skill.note}</p> : null}
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

function ConceptCardView({ spec }: { spec: ConceptCardBlock }) {
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
    </section>
  );
}

function ComparisonTableView({ spec }: { spec: ComparisonTableBlock }) {
  return (
    <section className={styles.uiCard} aria-label={spec.title || 'Comparison table'}>
      {spec.title ? (
        <header className={styles.uiHeader}>
          <div>
            <span className={styles.uiEyebrow}>Side-by-Side Comparison</span>
            <h4 className={styles.uiTitle}>{spec.title}</h4>
          </div>
        </header>
      ) : null}
      <div className={styles.tableWrap}>
        <table className={styles.uiTable}>
          {spec.columns.length > 0 ? (
            <thead>
              <tr>
                {spec.columns.map((col, idx) => (
                  <th key={idx} scope="col">
                    <RichSpan text={col} />
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {spec.rows.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx}>
                    <RichSpan text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {spec.verdict ? (
        <p className={styles.uiVerdict}>
          <b>Synthesis:</b> <RichSpan text={spec.verdict} />
        </p>
      ) : null}
    </section>
  );
}

function StepWalkthroughView({ spec }: { spec: StepWalkthroughBlock }) {
  return (
    <section className={styles.uiCard} aria-label={spec.title}>
      <header className={styles.uiHeader}>
        <div>
          <span className={styles.uiEyebrow}>Guided Walkthrough</span>
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
                <CitationChip cite={step.cite} />
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

function BookListView({ spec }: { spec: BookListBlock }) {
  return (
    <section className={styles.uiCard} aria-label={spec.title || 'Recommended books'}>
      <header className={styles.uiHeader}>
        <div>
          <span className={styles.uiEyebrow}>Library Recommendations</span>
          <h4 className={styles.uiTitle}>{spec.title || 'Recommended Reading'}</h4>
        </div>
      </header>
      <div className={styles.bookGrid}>
        {spec.books.map((item, idx) => {
          const href = item.book ? (citationToHref(item.book) ?? bookHref({ book: item.book })) : '';
          const cleanBook = item.book.split('#')[0] ?? '';
          const isPdf = cleanBook.toLowerCase().endsWith('.pdf');
          const displayTitle = item.title || cleanBook.split('/').pop() || 'Book';
          return (
            <article key={`${idx}-${item.book}`} className={styles.bookCard}>
              {isPdf && cleanBook ? (
                <img
                  src={`/thumb.jpg?path=${encodeURIComponent(cleanBook)}&width=140`}
                  alt=""
                  width={44}
                  height={60}
                  loading="lazy"
                  className={styles.bookThumb}
                />
              ) : null}
              <div className={styles.bookBody}>
                <div className={styles.bookTop}>
                  <strong className={styles.bookTitle}>{displayTitle}</strong>
                  {item.category ? <span className={styles.uiBadge}>{item.category}</span> : null}
                </div>
                <p className={styles.bookWhy}>{item.why}</p>
                <div className={styles.bookFoot}>
                  {item.start ? <span className={styles.bookStart}>Start: {item.start}</span> : null}
                  {href ? (
                    <SmartLink href={href} className={styles.uiCiteChip}>
                      Open book →
                    </SmartLink>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function QuizCheckView({
  spec,
  onPrompt,
}: {
  spec: QuizCheckBlock;
  onPrompt?: (prompt: string) => void;
}) {
  const [showHint, setShowHint] = useState(false);
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
          {spec.options.map((opt, idx) => (
            <button
              key={idx}
              type="button"
              className={styles.uiChipBtn}
              onClick={() => onPrompt(opt)}
            >
              <RichSpan text={opt} />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function OpenUIBlockView({
  code,
  closed = true,
  onPrompt,
}: {
  code: string;
  closed?: boolean;
  onPrompt?: (prompt: string) => void;
}) {
  const parsed = parseOpenUIBlock(code, closed);
  if (parsed.status === 'streaming') {
    return (
      <div className={styles.uiStreaming} role="status" aria-live="polite">
        <span className={styles.uiPulseDot} aria-hidden="true" />
        <span>Building {parsed.component || 'interactive view'}…</span>
      </div>
    );
  }
  if (parsed.status === 'invalid') {
    return (
      <pre>
        <code>{parsed.raw}</code>
      </pre>
    );
  }
  const { spec } = parsed;
  switch (spec.component) {
    case 'SkillMap':
      return <SkillMapView spec={spec} onPrompt={onPrompt} />;
    case 'ConceptCard':
      return <ConceptCardView spec={spec} />;
    case 'ComparisonTable':
      return <ComparisonTableView spec={spec} />;
    case 'StepWalkthrough':
      return <StepWalkthroughView spec={spec} />;
    case 'BookList':
      return <BookListView spec={spec} />;
    case 'QuizCheck':
      return <QuizCheckView spec={spec} onPrompt={onPrompt} />;
  }
}
