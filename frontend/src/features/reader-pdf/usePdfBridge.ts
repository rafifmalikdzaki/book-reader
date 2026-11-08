import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useSetBookContext } from '../../app';
import { useNotepad, type NoteDraft } from '../notepad';
import { bubblePosition, initialPage, parsePageHash } from './bridgeMath';
import { createProgressPoster } from './progress';
import { watchPdfFrame, type FrameWatcher } from './watchFrame';

export interface BubbleState {
  left: number;
  top: number;
  note: NoteDraft;
}

export interface UsePdfBridgeArgs {
  /** Book `rel` path (stable for the lifetime of the surface). */
  rel: string;
  /** Server-provided page, frozen at mount. */
  firstPage: number | null;
  frameRef: RefObject<HTMLIFrameElement | null>;
  shellRef: RefObject<HTMLElement | null>;
  bubbleRef: RefObject<HTMLElement | null>;
}

export interface PdfBridge {
  /** The viewer never initialised; show the native fallback. */
  fallback: boolean;
  bubble: BubbleState | null;
  addNote(): void;
}

const MAX_OWN_HASHES = 32;

/**
 * React side of pdf_reader.js. Page changes become a debounced progress POST, a replaced
 * `#p<n>` and a book-context update; `#p<n>` changes (router pushes do not fire
 * `hashchange`) move the viewer. Hashes this hook wrote itself are remembered so a late
 * location update never bounces the viewer back to a page it already left.
 */
export function usePdfBridge({
  rel,
  firstPage,
  frameRef,
  shellRef,
  bubbleRef,
}: UsePdfBridgeArgs): PdfBridge {
  const { hash, pathname, search } = useLocation();
  const navigate = useNavigate();
  const { compose } = useNotepad();
  const setBookContext = useSetBookContext();
  const [fallback, setFallback] = useState(false);
  const [bubble, setBubble] = useState<BubbleState | null>(null);

  const latest = useRef({ hash, pathname, search, navigate, compose, setBookContext });
  useEffect(() => {
    latest.current = { hash, pathname, search, navigate, compose, setBookContext };
  });
  const watcher = useRef<FrameWatcher | null>(null);
  const ownHashes = useRef<string[]>([]);

  useEffect(() => {
    latest.current.setBookContext({ book: rel, page: initialPage(latest.current.hash, firstPage) });
    return () => latest.current.setBookContext(null);
  }, [rel, firstPage]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const progress = createProgressPoster(rel);
    const own = ownHashes.current;
    const bound = watchPdfFrame(frame, shellRef.current, {
      getInitialPage: () => initialPage(latest.current.hash, firstPage),
      onPage(page, record) {
        const { setBookContext: setContext, navigate: go, pathname: path, search: query } =
          latest.current;
        setContext({ book: rel, page });
        const wanted = `#p${page}`;
        if ((own.at(-1) ?? latest.current.hash) !== wanted) {
          own.push(wanted);
          if (own.length > MAX_OWN_HASHES) own.shift();
          go({ pathname: path, search: query, hash: wanted }, { replace: true, preventScrollReset: true });
        }
        if (record) progress.post(page);
      },
      onSelection(selection) {
        if (!selection) {
          setBubble(null);
          return;
        }
        const position = bubblePosition(
          frame.getBoundingClientRect(),
          selection.rect,
          bubbleRef.current?.offsetWidth ?? 0,
          window.innerWidth,
        );
        setBubble({
          ...position,
          note: { book: rel, kind: 'pdf', page: selection.page, quote: selection.quote },
        });
      },
      onFallback: () => setFallback(true),
    });
    watcher.current = bound;
    return () => {
      bound.dispose();
      progress.flush();
      own.length = 0;
      watcher.current = null;
    };
  }, [rel, firstPage, frameRef, shellRef, bubbleRef]);

  // Deep links after mount: a note or citation for the open book pushes a new hash.
  useEffect(() => {
    const own = ownHashes.current;
    const index = own.indexOf(hash);
    if (index >= 0) {
      own.splice(0, index + 1);
      return;
    }
    own.length = 0;
    const requested = parsePageHash(hash);
    if (requested) watcher.current?.goTo(requested);
  }, [hash]);

  // Any press outside the bubble dismisses it (presses inside the iframe never reach here).
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.target !== bubbleRef.current) setBubble(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [bubbleRef]);

  const addNote = useCallback(() => {
    if (bubble) latest.current.compose(bubble.note);
    setBubble(null);
  }, [bubble]);

  return { fallback, bubble, addNote };
}
