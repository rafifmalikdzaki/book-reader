import { useState, type FormEvent } from 'react';

import { Button, cx, usePanel } from '../../ui';
import {
  clampPage,
  formatZoomValue,
  parseZoomValue,
  type ZoomMode,
} from './bridgeMath';
import styles from './PdfReader.module.css';
import type { PdfSearchController } from './usePdfSearch';

export interface PdfToolbarProps {
  title: string;
  rawUrl: string;
  currentPage: number;
  numPages: number;
  zoom: ZoomMode;
  effectiveScale: number;
  rotation: number;
  search: PdfSearchController;
  onSelectPage: (page: number) => void;
  onChangeZoom: (zoom: ZoomMode) => void;
  onStepZoom: (direction: 1 | -1) => void;
  onRotate: () => void;
  onToggleFullscreen: () => void;
}

export function PdfToolbar({
  title,
  rawUrl,
  currentPage,
  numPages,
  zoom,
  effectiveScale,
  rotation,
  search,
  onSelectPage,
  onChangeZoom,
  onStepZoom,
  onRotate,
  onToggleFullscreen,
}: PdfToolbarProps) {
  const contents = usePanel('contents');
  const [draftPage, setDraftPage] = useState<string | null>(null);
  const pageInput = draftPage ?? String(currentPage);

  const submitPage = (event: FormEvent) => {
    event.preventDefault();
    const target = clampPage(pageInput, numPages);
    setDraftPage(null);
    onSelectPage(target);
  };

  return (
    <div className={styles.toolbarWrap}>
      <div className={styles.toolbar} role="toolbar" aria-label="PDF reader controls">
        <div className={styles.toolbarGroup}>
          <Button variant="ghost" className={styles.toolBtn} {...contents.toggleProps}>
            Contents
          </Button>
          <span className={styles.divider} aria-hidden="true" />
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Previous page"
            disabled={currentPage <= 1}
            onClick={() => onSelectPage(clampPage(currentPage - 1, numPages))}
          >
            ‹
          </button>
          <form className={styles.pageForm} onSubmit={submitPage}>
            <input
              type="text"
              inputMode="numeric"
              aria-label="Page number"
              className={styles.pageInput}
              value={pageInput}
              onChange={(event) => setDraftPage(event.target.value)}
              onBlur={submitPage}
            />
            <span className={styles.pageTotal}>/ {numPages || 1}</span>
          </form>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Next page"
            disabled={numPages > 0 && currentPage >= numPages}
            onClick={() => onSelectPage(clampPage(currentPage + 1, numPages))}
          >
            ›
          </button>
        </div>

        <div className={styles.toolbarCenter} title={title}>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Zoom out"
            onClick={() => onStepZoom(-1)}
          >
            −
          </button>
          <select
            aria-label="Zoom level"
            className={styles.zoomSelect}
            value={formatZoomValue(zoom)}
            onChange={(event) => onChangeZoom(parseZoomValue(event.target.value))}
          >
            <option value="page-width">Fit Width ({Math.round(effectiveScale * 100)}%)</option>
            <option value="page-fit">Fit Page</option>
            <option value="0.5">50%</option>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
            <option value="1.25">125%</option>
            <option value="1.5">150%</option>
            <option value="2">200%</option>
          </select>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Zoom in"
            onClick={() => onStepZoom(1)}
          >
            +
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Rotate clockwise"
            title={`Rotate clockwise (current: ${rotation}°)`}
            onClick={onRotate}
          >
            ↻
          </button>
        </div>

        <div className={styles.toolbarGroup}>
          <button
            type="button"
            className={cx(styles.toolChip, search.open && styles.toolChipActive)}
            aria-label="Find in PDF"
            aria-expanded={search.open}
            onClick={() => search.setOpen(!search.open)}
          >
            Find
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Toggle fullscreen"
            title="Toggle fullscreen"
            onClick={onToggleFullscreen}
          >
            ⛶
          </button>
          <a
            className={styles.rawLink}
            href={rawUrl}
            target="_blank"
            rel="noreferrer"
            title="Open raw PDF in new tab"
          >
            PDF ↗
          </a>
        </div>
      </div>

      {search.open ? (
        <div className={styles.searchBar} role="search" aria-label="Find in PDF">
          <input
            type="search"
            aria-label="Find in document"
            placeholder="Find in document…"
            className={styles.searchInput}
            value={search.query}
            onChange={(event) => search.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (event.shiftKey) search.prevMatch();
                else search.nextMatch();
              } else if (event.key === 'Escape') {
                search.closeSearch();
              }
            }}
          />
          <span className={styles.searchStatus} aria-live="polite">
            {search.searching
              ? 'Searching…'
              : search.query.trim()
                ? search.matches.length > 0
                  ? `${search.activeIndex + 1} of ${search.matches.length}`
                  : 'No matches'
                : 'Type to search'}
          </span>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Previous match"
            disabled={search.matches.length === 0}
            onClick={search.prevMatch}
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Next match"
            disabled={search.matches.length === 0}
            onClick={search.nextMatch}
          >
            ↓
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Close find bar"
            onClick={search.closeSearch}
          >
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}
