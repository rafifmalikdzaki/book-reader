import styles from './openui/OpenUI.module.css';
import { BookListView } from './openui/components/BookList';
import { ChartView } from './openui/components/Chart';
import { ComparisonTableView } from './openui/components/ComparisonTable';
import { ConceptCardView } from './openui/components/ConceptCard';
import { ConceptGraphView } from './openui/components/ConceptGraph';
import { QuizCheckView } from './openui/components/QuizCheck';
import { SkillMapView } from './openui/components/SkillMap';
import { StepWalkthroughView } from './openui/components/StepWalkthrough';
import { parseOpenUIBlock } from './openui';

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
