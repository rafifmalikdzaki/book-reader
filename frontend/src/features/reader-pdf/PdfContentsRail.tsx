import { useState, type MouseEvent } from 'react';

import { ContentsPortal } from '../../app';
import {
  cx,
  MOBILE_QUERY,
  Rail,
  RailBody,
  RailResizeHandle,
  usePanel,
  useRailResize,
} from '../../ui';
import { isPageRendered } from './bridgeMath';
import { findActiveOutlineId, PdfPage, type PdfOutlineItem } from './pdfCore';
import styles from './PdfReader.module.css';

export interface PdfContentsRailProps {
  outline: PdfOutlineItem[];
  numPages: number;
  currentPage: number;
  onSelectPage: (page: number) => void;
}

type ContentsTab = 'outline' | 'thumbnails';

function OutlineTree({
  items,
  activeId,
  onJump,
}: {
  items: PdfOutlineItem[];
  activeId: string | null;
  onJump: (event: MouseEvent<HTMLAnchorElement>, pageNumber: number | null) => void;
}) {
  return (
    <ol className={styles.outlineList}>
      {items.map((item) => {
        const isCurrent = item.id === activeId;
        return (
          <li key={item.id} className={styles.outlineNode}>
            <a
              href={item.pageNumber ? `#p${item.pageNumber}` : '#'}
              className={cx(
                styles.outlineLink,
                item.level === 2 && styles.outlineLevel2,
                item.level >= 3 && styles.outlineLevel3,
                isCurrent && styles.outlineCurrent,
              )}
              aria-current={isCurrent ? 'location' : undefined}
              onClick={(event) => onJump(event, item.pageNumber)}
            >
              <span className={styles.outlineTitle}>{item.title}</span>
              {item.pageNumber !== null ? (
                <span className={styles.outlinePage}>p.{item.pageNumber}</span>
              ) : null}
            </a>
            {item.items.length > 0 ? (
              <OutlineTree items={item.items} activeId={activeId} onJump={onJump} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function PdfContentsRail({
  outline,
  numPages,
  currentPage,
  onSelectPage,
}: PdfContentsRailProps) {
  const panel = usePanel('contents');
  const [tab, setTab] = useState<ContentsTab>('outline');
  const resize = useRailResize({
    storageKey: 'br-outline-rail-width',
    initial: 268,
    min: 220,
    side: 'left',
  });

  const activeId = findActiveOutlineId(outline, currentPage);

  const handleOutlineClick = (
    event: MouseEvent<HTMLAnchorElement>,
    pageNumber: number | null,
  ) => {
    event.preventDefault();
    if (pageNumber !== null) {
      onSelectPage(pageNumber);
      if (window.matchMedia?.(MOBILE_QUERY).matches) panel.hide();
    }
  };

  const handleThumbnailClick = (page: number) => {
    onSelectPage(page);
    if (window.matchMedia?.(MOBILE_QUERY).matches) panel.hide();
  };

  return (
    <ContentsPortal>
      <Rail
        {...panel.railProps}
        side="left"
        label="Contents"
        title="Contents"
        width={resize.width}
        handle={<RailResizeHandle resize={resize} label="Resize contents panel" />}
      >
        <div className={styles.railTabs} role="tablist" aria-label="Document navigation">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'outline'}
            className={cx(styles.railTab, tab === 'outline' && styles.railTabActive)}
            onClick={() => setTab('outline')}
          >
            Outline ({outline.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'thumbnails'}
            className={cx(styles.railTab, tab === 'thumbnails' && styles.railTabActive)}
            onClick={() => setTab('thumbnails')}
          >
            Pages ({numPages})
          </button>
        </div>
        <RailBody>
          {tab === 'outline' ? (
            outline.length > 0 ? (
              <OutlineTree items={outline} activeId={activeId} onJump={handleOutlineClick} />
            ) : (
              <p className={styles.railEmpty}>No outline in this PDF.</p>
            )
          ) : (
            <div className={styles.thumbnailGrid} aria-label="Page thumbnails">
              {Array.from({ length: numPages }, (_, idx) => {
                const pageNum = idx + 1;
                const isActive = pageNum === currentPage;
                const renderPreview = panel.open && isPageRendered(pageNum, currentPage, 4);
                return (
                  <button
                    key={pageNum}
                    type="button"
                    className={cx(styles.thumbnailCard, isActive && styles.thumbnailCardActive)}
                    aria-label={`Go to page ${pageNum}`}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => handleThumbnailClick(pageNum)}
                  >
                    <div className={styles.thumbnailFrame}>
                      {renderPreview ? (
                        <PdfPage
                          pageNumber={pageNum}
                          width={124}
                          renderTextLayer={false}
                          renderAnnotationLayer={false}
                          suspense={false}
                          loading={<span className={styles.thumbnailPlaceholder}>p.{pageNum}</span>}
                        />
                      ) : (
                        <span className={styles.thumbnailPlaceholder}>p.{pageNum}</span>
                      )}
                    </div>
                    <span className={styles.thumbnailLabel}>Page {pageNum}</span>
                  </button>
                );
              })}
            </div>
          )}
        </RailBody>
      </Rail>
    </ContentsPortal>
  );
}
