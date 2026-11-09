import { useMemo } from 'react';

import styles from './OpenUI.module.css';
import { MATH_HINT, MathText } from '../MathText';
import { SmartLink } from '../SmartLink';
import { parseInline, type Inline } from '../markdown';
import {
  citationToHref,
} from '../legacyJson';

export const LEVEL_LABELS: Record<number, string> = {
  0: '0 · Unaware',
  1: '1 · Heard of it',
  2: '2 · Follow along',
  3: '3 · With help',
  4: '4 · Independent',
  5: '5 · Can teach',
};

export const TUTOR_COMMANDS = [
  { label: 'Show progress', prompt: 'show progress' },
  { label: 'Easier', prompt: 'easier' },
  { label: 'Harder', prompt: 'harder' },
  { label: 'Just tell me', prompt: 'just tell me' },
  { label: 'Save state', prompt: 'save state' },
] as const;

export function TextLeaf({ value }: { value: string }) {
  return MATH_HINT.test(value) ? <MathText text={value} /> : <>{value}</>;
}

export function InlineTokens({ nodes }: { nodes: Inline[] }) {
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

export function RichSpan({ text }: { text: string }) {
  const tokens = useMemo(() => parseInline(text), [text]);
  return <InlineTokens nodes={tokens} />;
}

export function CitationChip({ cite }: { cite?: string }) {
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

export function MasteryRing({ pct }: { pct: number }) {
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
