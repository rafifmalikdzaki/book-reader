import { useMemo, useState } from 'react';

import styles from './ChatRender.module.css';
import { MATH_HINT, MathText } from './MathText';
import { SmartLink } from './SmartLink';
import { bookHref } from './links';
import { parseInline, type Inline } from './markdown';
import {
  citationToHref,
  parseOpenUIBlock,
  type BookListBlock,
  type ChartBlock,
  type ComparisonTableBlock,
  type ConceptCardBlock,
  type ConceptGraphBlock,
  type GraphNode,
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

function TextLeaf({ value }: { value: string }) {
  return MATH_HINT.test(value) ? <MathText text={value} /> : <>{value}</>;
}

function InlineTokens({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case 'text':
        return <TextLeaf key={index} value={node.value} />;
      case 'strong':
        return (
          <strong key={index}>
            <InlineTokens nodes={node.children} />
          </strong>
        );
      case 'code':
        return <code key={index}>{node.value}</code>;
      case 'link':
        return (
          <SmartLink key={index} href={node.href}>
            <TextLeaf value={node.label} />
          </SmartLink>
        );
    }
  });
}

function RichSpan({ text }: { text: string }) {
  const tokens = useMemo(() => parseInline(text), [text]);
  return <InlineTokens nodes={tokens} />;
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

function MasteryRing({ pct }: { pct: number }) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, pct)) / 100) * circumference;
  return (
    <div className={styles.masteryRingWrap} title={`${pct}% overall mastery`}>
      <svg width={40} height={40} viewBox="0 0 40 40" aria-hidden="true" className={styles.masteryRingSvg}>
        <circle cx={20} cy={20} r={radius} className={styles.masteryRingTrack} />
        <circle
          cx={20}
          cy={20}
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={styles.masteryRingFill}
        />
      </svg>
      <span className={styles.masteryRingText}>{pct}%</span>
    </div>
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

function ConceptCardView({
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

function ComparisonTableView({ spec }: { spec: ComparisonTableBlock }) {
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

function StepWalkthroughView({
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

interface PositionedNode {
  node: GraphNode;
  col: number;
  row: number;
  x: number;
  y: number;
}

function computeGraphLayout(spec: ConceptGraphBlock): {
  positioned: Map<string, PositionedNode>;
  width: number;
  height: number;
} {
  const nodeMap = new Map<string, GraphNode>();
  for (const n of spec.nodes) nodeMap.set(n.id, n);

  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of spec.nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of spec.edges) {
    if (nodeMap.has(e.from) && nodeMap.has(e.to) && e.from !== e.to) {
      adj.get(e.from)?.push(e.to);
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }
  }

  const layerOf = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      layerOf.set(id, 0);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currLayer = layerOf.get(curr) ?? 0;
    for (const next of adj.get(curr) ?? []) {
      const nextLayer = Math.max(layerOf.get(next) ?? 0, currLayer + 1);
      if (nextLayer <= 5) {
        layerOf.set(next, nextLayer);
      }
      const nextDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, nextDeg);
      if (nextDeg === 0) queue.push(next);
    }
  }

  // Fallback for cyclic or disconnected nodes
  spec.nodes.forEach((n, idx) => {
    if (!layerOf.has(n.id)) {
      layerOf.set(n.id, idx % 3);
    }
  });

  const columns = new Map<number, GraphNode[]>();
  for (const n of spec.nodes) {
    const col = layerOf.get(n.id) ?? 0;
    const list = columns.get(col) ?? [];
    list.push(n);
    columns.set(col, list);
  }

  const sortedCols = Array.from(columns.keys()).sort((a, b) => a - b);
  const maxRows = Math.max(1, ...Array.from(columns.values()).map((list) => list.length));
  const nodeW = 164;
  const nodeH = 54;
  const colGap = 68;
  const rowGap = 24;
  const padX = 20;
  const padY = 20;

  const width = Math.max(420, padX * 2 + sortedCols.length * nodeW + Math.max(0, sortedCols.length - 1) * colGap);
  const height = Math.max(120, padY * 2 + maxRows * nodeH + Math.max(0, maxRows - 1) * rowGap);

  const positioned = new Map<string, PositionedNode>();
  sortedCols.forEach((colKey, colIdx) => {
    const nodesInCol = columns.get(colKey) ?? [];
    const colHeight = nodesInCol.length * nodeH + Math.max(0, nodesInCol.length - 1) * rowGap;
    const startY = Math.max(padY, Math.round((height - colHeight) / 2));
    nodesInCol.forEach((node, rowIdx) => {
      const x = padX + colIdx * (nodeW + colGap);
      const y = startY + rowIdx * (nodeH + rowGap);
      positioned.set(node.id, { node, col: colIdx, row: rowIdx, x, y });
    });
  });

  return { positioned, width, height };
}

function ConceptGraphView({
  spec,
  onPrompt,
}: {
  spec: ConceptGraphBlock;
  onPrompt?: (prompt: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>(spec.nodes[0]?.id ?? '');
  const { positioned, width, height } = useMemo(() => computeGraphLayout(spec), [spec]);
  const selected = positioned.get(selectedId)?.node ?? spec.nodes[0];
  const nodeW = 164;
  const nodeH = 54;

  return (
    <section className={styles.uiCard} aria-label={`Concept graph: ${spec.title}`}>
      <header className={styles.uiHeader}>
        <div>
          <span className={styles.uiEyebrow}>{spec.subtitle || 'Concept Architecture & Flow'}</span>
          <h4 className={styles.uiTitle}>
            <RichSpan text={spec.title} />
          </h4>
        </div>
        <CitationChip cite={spec.book} />
      </header>
      <div className={styles.graphScroll}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          className={styles.graphSvg}
          role="img"
          aria-label={spec.title}
        >
          <defs>
            <marker
              id="openui-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" className={styles.graphArrow} />
            </marker>
          </defs>
          {spec.edges.map((edge, idx) => {
            const fromPos = positioned.get(edge.from);
            const toPos = positioned.get(edge.to);
            if (!fromPos || !toPos) return null;
            const startX = fromPos.x + nodeW;
            const startY = fromPos.y + nodeH / 2;
            const endX = toPos.x;
            const endY = toPos.y + nodeH / 2;
            const midX = (startX + endX) / 2;
            const isHighlighted =
              selected && (edge.from === selected.id || edge.to === selected.id);
            const pathD =
              fromPos.col <= toPos.col
                ? `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`
                : `M ${fromPos.x} ${startY} C ${midX} ${startY - 36}, ${midX} ${endY - 36}, ${toPos.x + nodeW} ${endY}`;
            return (
              <g key={`${idx}-${edge.from}-${edge.to}`}>
                <path
                  d={pathD}
                  className={isHighlighted ? styles.graphEdgeActive : styles.graphEdge}
                  markerEnd="url(#openui-arrow)"
                />
                {edge.label ? (
                  <text
                    x={midX}
                    y={(startY + endY) / 2 - 6}
                    textAnchor="middle"
                    className={styles.graphEdgeLabel}
                  >
                    {edge.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {Array.from(positioned.values()).map(({ node, x, y }) => {
            const isSelected = selected?.id === node.id;
            const label =
              node.label.length > 21 ? `${node.label.slice(0, 19).trim()}…` : node.label;
            return (
              <g
                key={node.id}
                transform={`translate(${x}, ${y})`}
                className={isSelected ? styles.graphNodeActive : styles.graphNode}
                role="button"
                tabIndex={0}
                aria-label={`Select concept node ${node.label}`}
                aria-pressed={isSelected}
                onClick={() => setSelectedId(node.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedId(node.id);
                  }
                }}
              >
                <rect width={nodeW} height={nodeH} rx={6} className={styles.graphNodeBox} />
                {node.group ? (
                  <text x={12} y={18} className={styles.graphNodeGroup}>
                    {node.group.toUpperCase()}
                  </text>
                ) : null}
                <text x={12} y={node.group ? 37 : 31} className={styles.graphNodeTitle}>
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {selected ? (
        <div className={styles.graphInspector}>
          <div className={styles.graphInspectorHead}>
            <strong>
              <RichSpan text={selected.label} />
            </strong>
            {selected.group ? <span className={styles.uiBadge}>{selected.group}</span> : null}
            <CitationChip cite={selected.cite} />
          </div>
          {selected.detail ? (
            <p className={styles.graphInspectorDetail}>
              <RichSpan text={selected.detail} />
            </p>
          ) : null}
          {onPrompt ? (
            <div className={styles.graphInspectorActions}>
              <button
                type="button"
                className={styles.uiChipBtn}
                onClick={() =>
                  onPrompt(`Explain ${selected.label} in the context of ${spec.title}`)
                }
              >
                Explore {selected.label} →
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ChartView({ spec }: { spec: ChartBlock }) {
  const maxVal = Math.max(1, ...spec.items.map((item) => Math.abs(item.value)));
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
                <div className={styles.chartFill} style={{ width: `${pct}%` }} />
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

function BookListView({
  spec,
  onPrompt,
}: {
  spec: BookListBlock;
  onPrompt?: (prompt: string) => void;
}) {
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
                <p className={styles.bookWhy}>
                  <RichSpan text={item.why} />
                </p>
                <div className={styles.bookFoot}>
                  {item.start ? <span className={styles.bookStart}>Start: {item.start}</span> : null}
                  <div className={styles.bookActions}>
                    {onPrompt && cleanBook ? (
                      <button
                        type="button"
                        className={styles.uiChipBtn}
                        onClick={() =>
                          onPrompt(`Show me the chapter outline of ${cleanBook}`)
                        }
                      >
                        Inspect outline
                      </button>
                    ) : null}
                    {href ? (
                      <SmartLink href={href} className={styles.uiCiteChip}>
                        Open book →
                      </SmartLink>
                    ) : null}
                  </div>
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
      return <ConceptCardView spec={spec} onPrompt={onPrompt} />;
    case 'ComparisonTable':
      return <ComparisonTableView spec={spec} />;
    case 'StepWalkthrough':
      return <StepWalkthroughView spec={spec} onPrompt={onPrompt} />;
    case 'ConceptGraph':
      return <ConceptGraphView spec={spec} onPrompt={onPrompt} />;
    case 'Chart':
      return <ChartView spec={spec} />;
    case 'BookList':
      return <BookListView spec={spec} onPrompt={onPrompt} />;
    case 'QuizCheck':
      return <QuizCheckView spec={spec} onPrompt={onPrompt} />;
  }
}
