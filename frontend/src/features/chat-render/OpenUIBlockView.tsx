import { Renderer } from '@openuidev/react-lang';
import type { OpenUIError } from '@openuidev/lang-core';
import { useState } from 'react';

import type { OpenUIFormat } from './markdown';
import { parseOpenUIBlock } from './legacyJson';
import { BookListView } from './openui/components/BookList';
import { ChartView } from './openui/components/Chart';
import { ComparisonTableView } from './openui/components/ComparisonTable';
import { ConceptCardView } from './openui/components/ConceptCard';
import { ConceptGraphView } from './openui/components/ConceptGraph';
import { QuizCheckView } from './openui/components/QuizCheck';
import { SkillMapView } from './openui/components/SkillMap';
import { StepWalkthroughView } from './openui/components/StepWalkthrough';
import { openuiLibrary } from './openui/library';
import { PromptContext } from './openui/promptContext';
import styles from './openui/OpenUI.module.css';

type PromptSender = ((prompt: string) => void) | undefined;

/** OpenUI Lang: rendered progressively by the official Renderer while the answer streams. */
function LangBlock({ code, closed }: { code: string; closed: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!closed && !code.trim()) {
    return (
      <div className={styles.uiStreaming} role="status" aria-live="polite">
        <span className={styles.uiPulseDot} aria-hidden="true" />
        <span>Building interactive view…</span>
      </div>
    );
  }
  const onError = (errors: OpenUIError[]) => {
    setFailed(errors.some((error) => error.severity !== 'warning'));
  };
  return (
    <>
      <Renderer library={openuiLibrary} response={code} isStreaming={!closed} onError={onError} />
      {closed && failed ? (
        <details className={styles.uiErrors}>
          <summary>Part of this view could not be rendered</summary>
          <pre>
            <code>{code}</code>
          </pre>
        </details>
      ) : null}
    </>
  );
}

/** Legacy JSON blocks stored in older chats. */
function JsonBlock({
  code,
  closed,
  onPrompt,
}: {
  code: string;
  closed: boolean;
  onPrompt: PromptSender;
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

export function OpenUIBlockView({
  code,
  closed = true,
  format = 'json',
  onPrompt,
}: {
  code: string;
  closed?: boolean;
  format?: OpenUIFormat;
  onPrompt?: (prompt: string) => void;
}) {
  return (
    <PromptContext.Provider value={onPrompt}>
      {format === 'lang' ? (
        <LangBlock code={code} closed={closed} />
      ) : (
        <JsonBlock code={code} closed={closed} onPrompt={onPrompt} />
      )}
    </PromptContext.Provider>
  );
}
