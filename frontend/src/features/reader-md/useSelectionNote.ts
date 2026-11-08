import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { useNotepad, type NoteDraft } from '../notepad';
import { paragraphIndex, sectionPath } from './selection';

export interface Bubble {
  left: number;
  top: number;
  draft: NoteDraft;
}

/**
 * Selection-to-note: a "+ Note" bubble above a non-empty selection inside the article,
 * carrying the section path and paragraph number. Mouse selection responds immediately;
 * keyboard and touch selections arrive through `selectionchange`/`touchend`. The server
 * locates the quote in the source to fill line and character ranges.
 */
export function useSelectionNote(
  article: RefObject<HTMLElement | null>,
  book: string,
): { bubble: Bubble | null; capture: () => void } {
  const { compose } = useNotepad();
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = useCallback(() => {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = null;
  }, []);

  const readSelection = useCallback(() => {
    const root = article.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed || !selection.rangeCount) {
      setBubble(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const quote = selection.toString().trim();
    if (!root.contains(range.commonAncestorContainer) || !quote) {
      setBubble(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setBubble({
      left: Math.max(8, rect.left),
      top: Math.max(70, rect.top - 40),
      draft: {
        book,
        kind: 'md',
        quote,
        section: sectionPath(root, range.commonAncestorContainer),
        paragraph: paragraphIndex(root, range.commonAncestorContainer),
      },
    });
  }, [article, book]);

  useEffect(() => {
    const later = (ms: number) => {
      clearPending();
      pending.current = setTimeout(readSelection, ms);
    };
    const onMouseUp = () => {
      clearPending();
      readSelection();
    };
    const onTouchEnd = () => later(250);
    const onSelectionChange = () => later(200);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      clearPending();
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [readSelection, clearPending]);

  const capture = useCallback(() => {
    clearPending();
    if (bubble) compose(bubble.draft);
    window.getSelection()?.removeAllRanges();
    setBubble(null);
  }, [bubble, compose, clearPending]);

  return { bubble, capture };
}
