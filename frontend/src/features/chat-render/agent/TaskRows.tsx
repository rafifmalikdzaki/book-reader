import { useState } from 'react';

import styles from './TaskRows.module.css';

/* Ported from beautiful-ui primitives/TaskRows.tsx (MIT, slev12397/beautiful-ui).
 * Static statuses (done / running / failed) instead of the demo sequence. */

export interface TaskDetail {
  label: string;
  meta: string;
}

export interface TaskRowData {
  key: string;
  label: string;
  amount?: string;
  status: 'done' | 'running' | 'failed';
  step?: number;
  details?: TaskDetail[];
}

function SpinnerRing({ active, children }: { active?: boolean; children?: React.ReactNode }) {
  const size = 24;
  const stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className={styles.ring} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className={styles.ringSvg}
        style={active ? { animation: 'spin 1.1s linear infinite' } : undefined}
        aria-hidden="true"
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--rule)" strokeWidth={stroke} />
        {active ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * 0.28} ${c * 0.72}`}
          />
        ) : null}
      </svg>
      <span className={styles.ringText}>{children}</span>
    </span>
  );
}

function Badge({ tone, children }: { tone: 'ok' | 'bad'; children: React.ReactNode }) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      {children}
    </span>
  );
}

const XIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);
const CheckIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export function TaskRows({ rows }: { rows: TaskRowData[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className={styles.rows}>
      {rows.map((row, i) => {
        const isOpen = open[row.key] ?? false;
        return (
          <div
            key={row.key}
            role="listitem"
            className={styles.row}
            style={{ borderRadius: isOpen ? 14 : 22, animationDelay: `${i * 80}ms` }}
          >
            <button
              type="button"
              className={styles.rowHead}
              aria-expanded={isOpen}
              onClick={() => setOpen((cur) => ({ ...cur, [row.key]: !isOpen }))}
            >
              <span className={styles.badgeSlot}>
                {row.status === 'done' ? (
                  <Badge tone="ok">{CheckIcon}</Badge>
                ) : row.status === 'failed' ? (
                  <Badge tone="bad">{XIcon}</Badge>
                ) : (
                  <SpinnerRing active>{row.step}</SpinnerRing>
                )}
              </span>
              <span className={styles.label}>{row.label}</span>
              {row.amount ? <span className={styles.amount}>{row.amount}</span> : null}
              {row.status === 'done' ? <span className={`${styles.pill} ${styles.pillOk}`}>Completed</span> : null}
              {row.status === 'failed' ? <span className={`${styles.pill} ${styles.pillBad}`}>Failed</span> : null}
              <span className={styles.rowChevron} data-open={isOpen} aria-hidden="true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>
            <div className={styles.details} data-open={isOpen}>
              <div className={styles.detailsClip}>
                {row.details?.map((d) => (
                  <div key={d.label} className={styles.detailRow}>
                    <span>{d.label}</span>
                    <span className={styles.detailMeta}>{d.meta}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
