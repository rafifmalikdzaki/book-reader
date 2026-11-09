import { useMemo, useState } from 'react';

import styles from '../OpenUI.module.css';
import {
  type ConceptGraphBlock,
} from '../../openui';
import { CitationChip, RichSpan } from '../shared';
import { computeGraphLayout } from '../graphLayout';

export function ConceptGraphView({
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
