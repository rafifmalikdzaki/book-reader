import { useLayoutEffect, useRef } from 'react';

import { renderMath } from './katex';

/** Cheap pre-check: only text that can contain a delimiter pays for the KaTeX path. */
export const MATH_HINT = /\$|\\[([]/;

/**
 * Text that may hold LaTeX. KaTeX rewrites the DOM it is given, so React must never own
 * those nodes: this renders one empty `<span>` (no React children, ever), writes the raw
 * text into it with `textContent` (never HTML), then lets auto-render typeset it in place.
 * A change of `text` simply rewrites the span, so reconciliation and KaTeX cannot fight.
 */
export function MathText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.textContent = text;
    renderMath(node);
  }, [text]);
  return <span ref={ref} />;
}
