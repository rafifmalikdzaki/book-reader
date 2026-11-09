import chatStyles from '../../ChatRender.module.css';
import styles from '../OpenUI.module.css';
import {
  type ComparisonTableBlock,
} from '../../legacyJson';
import { RichSpan } from '../shared';

export function ComparisonTableView({ spec }: { spec: ComparisonTableBlock }) {
  return (
    <section className={styles.uiCard} aria-label={spec.title || 'Comparison table'}>
      {spec.title ? (
        <header className={styles.uiHeader}>
          <div>
            <span className={styles.uiEyebrow}>Side-by-Side Comparison</span>
            <h4 className={styles.uiTitle}>
              <RichSpan text={spec.title} />
            </h4>
          </div>
        </header>
      ) : null}
      <div className={chatStyles.tableWrap}>
        <table className={chatStyles.uiTable}>
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
