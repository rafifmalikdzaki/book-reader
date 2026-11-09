import styles from '../OpenUI.module.css';
import {
  type ChartBlock,
} from '../../legacyJson';
import { CitationChip, RichSpan } from '../shared';

export function ChartView({ spec }: { spec: ChartBlock }) {
  const maxVal = Math.max(...spec.items.map((item) => Math.abs(item.value))) || 1;
  return (
    <section className={styles.uiCard} aria-label={`Chart: ${spec.title}`}>
      <header className={styles.uiHeader}>
        <div>
          <span className={styles.uiEyebrow}>{spec.subtitle || 'Quantitative Comparison'}</span>
          <h4 className={styles.uiTitle}>
            <RichSpan text={spec.title} />
          </h4>
        </div>
        <CitationChip cite={spec.book} />
      </header>
      <div className={styles.chartList}>
        {spec.items.map((item, idx) => {
          const pct = Math.max(4, Math.min(100, Math.round((Math.abs(item.value) / maxVal) * 100)));
          const readout =
            item.displayValue ||
            `${item.value}${spec.unit ? ` ${spec.unit}` : ''}`;
          return (
            <div key={`${idx}-${item.label}`} className={styles.chartRow}>
              <div className={styles.chartRowTop}>
                <span className={styles.chartLabel}>
                  <RichSpan text={item.label} />
                </span>
                <span className={styles.chartValue}>{readout}</span>
              </div>
              <div className={styles.chartTrack}>
                <div
                  className={item.value < 0 ? styles.chartFillNegative : styles.chartFill}
                  data-negative={item.value < 0 ? 'true' : undefined}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {item.note ? (
                <p className={styles.chartNote}>
                  <RichSpan text={item.note} />
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {spec.caption ? (
        <p className={styles.chartCaption}>
          <RichSpan text={spec.caption} />
        </p>
      ) : null}
    </section>
  );
}
