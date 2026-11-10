import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import type { BookDetail } from '../../api/types';
import { useSetBookContext, useStage } from '../../app';
import { readStorage, writeStorage } from '../../app/storage';
import { buttonClassName, cx } from '../../ui';
import { useNotepad, type NoteDraft } from '../notepad';
import {
  bubblePosition,
  clampPage,
  computePageDimensions,
  DEFAULT_INTRINSIC_HEIGHT,
  DEFAULT_INTRINSIC_WIDTH,
  highlightSearchHtml,
  initialPage,
  isPageRendered,
  nextRotation,
  PAGE_OVERSCAN,
  pageRows,
  parsePageHash,
  SPREAD_MIN_WIDTH,
  stepZoom,
  type ZoomMode,
} from './bridgeMath';
import {
  extractPdfOutline,
  PDF_DOCUMENT_OPTIONS,
  PdfDocument,
  PdfPage,
  type PdfDocumentLike,
  type PdfOutlineItem,
  type PdfPageLike,
} from './pdfCore';
import { PdfContentsRail } from './PdfContentsRail';
import styles from './PdfReader.module.css';
import { PdfToolbar } from './PdfToolbar';
import { createProgressPoster } from './progress';
import { bindSelectionEvents, readContainerSelection } from './selection';
import { createTimers } from './timers';
import { usePdfSearch } from './usePdfSearch';

export interface PdfReaderProps {
  /** Non-redirect `getBook` response with kind === 'pdf'. */
  book: BookDetail;
}

interface BubbleState {
  left: number;
  top: number;
  note: NoteDraft;
}

const MAX_OWN_HASHES = 32;
const RESIZE_DEBOUNCE_MS = 180;
/** Remembered across books: a reader who likes facing pages likes them everywhere. */
const SPREAD_STORAGE_KEY = 'book-reader.pdf-spread';

function rawHref(rel: string): string {
  return '/raw/' + rel.split('/').map(encodeURIComponent).join('/');
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className={styles.errorPanel}>
      <h1>This book wouldn’t open</h1>
      <p>{message}</p>
      <Link className={buttonClassName()} to="/">
        Back to the library
      </Link>
    </div>
  );
}

/**
 * Jumps the reader makes glide (the container scrolls smoothly); restoring a position after a
 * reload or a reflow must be `instant`, or the pages passed on the way are taken for the
 * reader's place.
 */
function scrollPageSlotIntoView(
  container: HTMLElement | null,
  pageNumber: number,
  behavior: ScrollBehavior = 'auto',
): void {
  if (!container) return;
  const target = container.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
  if (!target) return;
  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ block: 'start', behavior });
  }
}

/** How far the viewport top sits below the top of `pageNumber`, as a share of its height. */
function pageOffsetFraction(container: HTMLElement, pageNumber: number): number {
  const slot = container.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
  const rect = slot?.getBoundingClientRect();
  if (!rect || rect.height <= 0) return 0;
  const fraction = (container.getBoundingClientRect().top - rect.top) / rect.height;
  return Math.min(1, Math.max(-1, fraction));
}

function detectVisiblePage(container: HTMLElement): number | null {
  const slots = container.querySelectorAll<HTMLElement>('.page[data-page-number]');
  if (slots.length === 0) return null;
  const containerRect = container.getBoundingClientRect();
  const probeY = containerRect.top + Math.min(240, Math.max(80, containerRect.height * 0.3));

  let bestPage: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const slot of slots) {
    const page = Number(slot.dataset.pageNumber);
    if (!Number.isFinite(page) || page < 1) continue;
    const rect = slot.getBoundingClientRect();
    if (rect.top <= probeY && rect.bottom >= probeY) {
      return page;
    }
    const distance = Math.abs(rect.top - probeY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPage = page;
    }
  }
  return bestPage;
}

function PdfSurface({ book }: PdfReaderProps) {
  const { hash, pathname, search } = useLocation();
  const navigate = useNavigate();
  const { compose } = useNotepad();
  const setBookContext = useSetBookContext();

  const [firstPage] = useState(() => initialPage(hash, book.page));
  const [currentPage, setCurrentPage] = useState<number>(firstPage);
  const [numPages, setNumPages] = useState<number>(() => Math.max(1, book.page_count ?? firstPage));
  const [pdfDoc, setPdfDoc] = useState<PdfDocumentLike | null>(null);
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [zoom, setZoom] = useState<ZoomMode>('page-width');
  const [rotation, setRotation] = useState<number>(0);
  const [spreadWanted, setSpreadWanted] = useState(() => readStorage(SPREAD_STORAGE_KEY) === '1');
  const [intrinsicSize, setIntrinsicSize] = useState({
    width: DEFAULT_INTRINSIC_WIDTH,
    height: DEFAULT_INTRINSIC_HEIGHT,
  });
  const [containerSize, setContainerSize] = useState({ width: 860, height: 780 });
  const [fallback, setFallback] = useState(false);
  const [bubble, setBubble] = useState<BubbleState | null>(null);

  const shellRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const ownHashes = useRef<string[]>([]);
  const programmaticScroll = useRef(false);
  // Position within the current page (0 = its top edge at the top of the viewport).
  const pageOffset = useRef(0);
  const currentPageRef = useRef(currentPage);
  const numPagesRef = useRef(numPages);

  useEffect(() => {
    currentPageRef.current = currentPage;
    numPagesRef.current = numPages;
  });

  const latest = useRef({ hash, pathname, search, navigate, compose, setBookContext });
  useEffect(() => {
    latest.current = { hash, pathname, search, navigate, compose, setBookContext };
  });

  const progressRef = useRef<ReturnType<typeof createProgressPoster> | null>(null);
  useEffect(() => {
    const poster = createProgressPoster(book.rel);
    progressRef.current = poster;
    return () => {
      poster.flush();
      progressRef.current = null;
    };
  }, [book.rel]);

  useEffect(() => {
    latest.current.setBookContext({ book: book.rel, page: firstPage });
    return () => latest.current.setBookContext(null);
  }, [book.rel, firstPage]);

  const commitPage = useCallback(
    (rawPage: number, options: { record?: boolean; scroll?: boolean } = {}) => {
      const page = clampPage(rawPage, numPagesRef.current);
      currentPageRef.current = page;
      if (options.scroll) pageOffset.current = 0;
      setCurrentPage(page);

      const {
        setBookContext: setContext,
        navigate: go,
        pathname: path,
        search: query,
      } = latest.current;
      setContext({ book: book.rel, page });

      const wanted = `#p${page}`;
      const own = ownHashes.current;
      if ((own.at(-1) ?? latest.current.hash) !== wanted) {
        own.push(wanted);
        if (own.length > MAX_OWN_HASHES) own.shift();
        go({ pathname: path, search: query, hash: wanted }, { replace: true, preventScrollReset: true });
      }

      if (options.record !== false) {
        progressRef.current?.post(page);
      }

      if (options.scroll) {
        programmaticScroll.current = true;
        scrollPageSlotIntoView(viewportRef.current, page);
        window.setTimeout(() => {
          programmaticScroll.current = false;
        }, 120);
      }
    },
    [book.rel],
  );

  // Follow external `#p<n>` deep links after mount without feedback loops.
  useEffect(() => {
    const own = ownHashes.current;
    const index = own.indexOf(hash);
    if (index >= 0) {
      own.splice(0, index + 1);
      return;
    }
    own.length = 0;
    const requested = parsePageHash(hash);
    if (requested > 0) {
      commitPage(requested, { record: true, scroll: true });
    }
  }, [hash, commitPage]);

  // Refit responsive page dimensions 180ms after `#pdf-shell` resizes.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      const rect = shell.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    };
    measure();

    let timer: number | null = null;
    const observer = new ResizeObserver(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        measure();
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(shell);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  // Bind text selection inside `#pdf-viewer-container` to the "+ Note" bubble.
  useEffect(() => {
    const timers = createTimers();
    const evaluateSelection = () => {
      const sel = readContainerSelection(viewportRef.current, () => currentPageRef.current);
      if (!sel) {
        setBubble(null);
        return;
      }
      const pos = bubblePosition(
        { left: 0, top: 0 },
        sel.rect,
        bubbleRef.current?.offsetWidth ?? 0,
        window.innerWidth,
      );
      setBubble({
        ...pos,
        note: { book: book.rel, kind: 'pdf', page: sel.page, quote: sel.quote },
      });
    };
    const unbind = bindSelectionEvents(document, evaluateSelection, timers);
    return () => {
      unbind();
      timers.clearAll();
    };
  }, [book.rel]);

  // Dismiss bubble on outside press.
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.target !== bubbleRef.current) setBubble(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const searchController = usePdfSearch(pdfDoc, numPages, (targetPage) => {
    commitPage(targetPage, { record: true, scroll: true });
  });

  const handleDocumentLoadSuccess = useCallback(
    (loadedDoc: PdfDocumentLike) => {
      setFallback(false);
      setPdfDoc(loadedDoc);
      const total = Math.max(1, loadedDoc.numPages || book.page_count || 1);
      numPagesRef.current = total;
      setNumPages(total);

      const startPage = clampPage(initialPage(latest.current.hash, firstPage), total);
      currentPageRef.current = startPage;
      setCurrentPage(startPage);
      latest.current.setBookContext({ book: book.rel, page: startPage });

      if (startPage > 1) {
        window.setTimeout(() => {
          scrollPageSlotIntoView(viewportRef.current, startPage, 'instant');
        }, 0);
      }

      void extractPdfOutline(loadedDoc).then(setOutline);
    },
    [book.page_count, book.rel, firstPage],
  );

  const handleDocumentLoadError = useCallback(() => {
    setFallback(true);
  }, []);

  const handlePageLoadSuccess = useCallback((page: PdfPageLike) => {
    const w = page.originalWidth ?? page.width;
    const h = page.originalHeight ?? page.height;
    if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
      setIntrinsicSize((prev) =>
        prev.width === Math.round(w) && prev.height === Math.round(h)
          ? prev
          : { width: Math.round(w), height: Math.round(h) },
      );
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (programmaticScroll.current) return;
    const container = viewportRef.current;
    if (!container) return;
    const visible = detectVisiblePage(container);
    if (visible !== null && visible !== currentPageRef.current) {
      commitPage(visible, { record: true, scroll: false });
    }
    pageOffset.current = pageOffsetFraction(container, currentPageRef.current);
  }, [commitPage]);

  const spreadAvailable = containerSize.width >= SPREAD_MIN_WIDTH;
  const spread = spreadWanted && spreadAvailable;
  const rows = useMemo(() => pageRows(numPages, spread), [numPages, spread]);

  const pageDims = useMemo(
    () =>
      computePageDimensions({
        containerWidth: containerSize.width,
        containerHeight: containerSize.height,
        intrinsicWidth: intrinsicSize.width,
        intrinsicHeight: intrinsicSize.height,
        zoom,
        rotation,
        columns: spread ? 2 : 1,
      }),
    [
      containerSize.height,
      containerSize.width,
      intrinsicSize.height,
      intrinsicSize.width,
      rotation,
      spread,
      zoom,
    ],
  );

  // Zooming, resizing or switching to facing pages reflows every slot; keep the reader at the
  // same spot of the same page.
  const anchored = useRef(false);
  useLayoutEffect(() => {
    if (!anchored.current) {
      anchored.current = true;
      return;
    }
    const container = viewportRef.current;
    programmaticScroll.current = true;
    scrollPageSlotIntoView(container, currentPageRef.current, 'instant');
    if (container && pageOffset.current !== 0 && typeof container.scrollBy === 'function') {
      const slot = container.querySelector<HTMLElement>(
        `.page[data-page-number="${currentPageRef.current}"]`,
      );
      const height = slot?.getBoundingClientRect().height ?? 0;
      container.scrollBy({ top: pageOffset.current * height, behavior: 'instant' });
    }
    const timer = window.setTimeout(() => {
      programmaticScroll.current = false;
    }, 120);
    return () => window.clearTimeout(timer);
  }, [pageDims.height, pageDims.width, spread]);

  const customTextRenderer = useMemo(() => {
    const q = searchController.open ? searchController.query.trim() : '';
    if (!q) return undefined;
    return ({ str }: { str: string }) => highlightSearchHtml(str, q);
  }, [searchController.open, searchController.query]);

  const handleStepZoom = useCallback(
    (direction: 1 | -1) => {
      setZoom(stepZoom(pageDims.scale, direction));
    },
    [pageDims.scale],
  );

  const handleRotate = useCallback(() => {
    setRotation((prev) => nextRotation(prev));
  }, []);

  const handleToggleSpread = useCallback(() => {
    setSpreadWanted((prev) => {
      writeStorage(SPREAD_STORAGE_KEY, prev ? '0' : '1');
      return !prev;
    });
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (!document.fullscreenElement && typeof shell.requestFullscreen === 'function') {
      void shell.requestFullscreen().catch(() => {});
    } else if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      void document.exitFullscreen().catch(() => {});
    }
  }, []);

  const addNote = useCallback(() => {
    if (bubble) latest.current.compose(bubble.note);
    setBubble(null);
  }, [bubble]);

  const fileUrl = rawHref(book.rel);

  // Facing pages need one more page of overscan so both halves of the next spread are ready.
  const overscan = spread ? PAGE_OVERSCAN + 1 : PAGE_OVERSCAN;
  const renderSlot = (pageNumber: number) => {
    const shouldRenderCanvas = isPageRendered(pageNumber, currentPage, overscan);
    return (
      <div
        key={pageNumber}
        id={`pdf-page-${pageNumber}`}
        className={cx(styles.pageSlot, 'page', pageNumber === currentPage && styles.pageSlotCurrent)}
        data-page-number={pageNumber}
        style={{
          width: `${pageDims.width}px`,
          minHeight: `${pageDims.height}px`,
        }}
      >
        {shouldRenderCanvas ? (
          <PdfPage
            pageNumber={pageNumber}
            width={pageDims.width}
            rotate={rotation}
            renderTextLayer
            renderAnnotationLayer
            customTextRenderer={customTextRenderer}
            suspense={false}
            onLoadSuccess={pageNumber === 1 ? handlePageLoadSuccess : undefined}
            loading={<div className={styles.pagePlaceholder}>Page {pageNumber}</div>}
          />
        ) : (
          <div className={styles.pagePlaceholder}>Page {pageNumber}</div>
        )}
        <span className={styles.pageBadge} aria-hidden="true">
          {pageNumber} / {numPages}
        </span>
      </div>
    );
  };

  return (
    <>
      <PdfContentsRail
        outline={outline}
        numPages={numPages}
        currentPage={currentPage}
        onSelectPage={(page) => commitPage(page, { record: true, scroll: true })}
      />
      <div
        ref={shellRef}
        className={styles.shell}
        id="pdf-shell"
        data-book={book.rel}
        data-page={currentPage}
      >
        <PdfToolbar
          title={book.title}
          rawUrl={fileUrl}
          currentPage={currentPage}
          numPages={numPages}
          zoom={zoom}
          effectiveScale={pageDims.scale}
          rotation={rotation}
          spread={spread}
          spreadAvailable={spreadAvailable}
          search={searchController}
          onSelectPage={(page) => commitPage(page, { record: true, scroll: true })}
          onChangeZoom={setZoom}
          onStepZoom={handleStepZoom}
          onRotate={handleRotate}
          onToggleSpread={handleToggleSpread}
          onToggleFullscreen={handleToggleFullscreen}
        />

        <div
          ref={viewportRef}
          id="pdf-viewer-container"
          className={cx(styles.viewport, fallback && styles.frameHidden)}
          role="region"
          aria-label={book.title}
          onScroll={handleScroll}
        >
          <PdfDocument
            file={fileUrl}
            options={PDF_DOCUMENT_OPTIONS}
            rotate={rotation}
            suspense={false}
            className={styles.document}
            loading={
              <div className={styles.loadingState} role="status">
                Loading {book.title}…
              </div>
            }
            error={null}
            onLoadSuccess={handleDocumentLoadSuccess}
            onLoadError={handleDocumentLoadError}
            onSourceError={handleDocumentLoadError}
          >
            {rows.map((row) =>
              row.length === 1 && !spread ? (
                renderSlot(row[0] ?? 1)
              ) : (
                <div key={`row-${row[0]}`} className={styles.spreadRow} data-spread-row>
                  {row.map(renderSlot)}
                </div>
              ),
            )}
          </PdfDocument>
        </div>

        {fallback ? (
          <div className={styles.fallback} id="pdf-fallback">
            <p>The native PDF viewer could not start in this browser.</p>
            <a className={buttonClassName()} href={fileUrl} target="_blank" rel="noreferrer">
              Open PDF
            </a>
          </div>
        ) : null}
      </div>

      <button
        ref={bubbleRef}
        id="note-capture"
        type="button"
        className={styles.bubble}
        hidden={!bubble}
        style={bubble ? { left: bubble.left, top: bubble.top } : undefined}
        onClick={addNote}
      >
        + Note
      </button>
    </>
  );
}

export function PdfReader({ book }: PdfReaderProps) {
  useStage('pdf');
  if (book.error || !book.viewer_url) {
    return <ErrorPanel message={book.error ?? 'The PDF viewer is unavailable for this file.'} />;
  }
  return <PdfSurface key={book.rel} book={book} />;
}
