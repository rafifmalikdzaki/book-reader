import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PdfDocumentLike } from './pdfCore';

export interface PdfSearchMatch {
  pageNumber: number;
  occurrence: number;
}

export interface PdfSearchController {
  open: boolean;
  setOpen: (open: boolean) => void;
  query: string;
  setQuery: (query: string) => void;
  matches: PdfSearchMatch[];
  activeIndex: number;
  searching: boolean;
  nextMatch: () => void;
  prevMatch: () => void;
  closeSearch: () => void;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  const lowerH = haystack.toLowerCase();
  const lowerN = needle.toLowerCase();
  let count = 0;
  let pos = 0;
  while (pos <= lowerH.length - lowerN.length) {
    const idx = lowerH.indexOf(lowerN, pos);
    if (idx === -1) break;
    count += 1;
    pos = idx + Math.max(1, lowerN.length);
  }
  return count;
}

export function usePdfSearch(
  doc: PdfDocumentLike | null,
  numPages: number,
  onNavigatePage: (page: number) => void,
): PdfSearchController {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [rawMatches, setRawMatches] = useState<PdfSearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);

  const pageTextCache = useRef<Map<number, string>>(new Map());
  const navigateRef = useRef(onNavigatePage);
  useEffect(() => {
    navigateRef.current = onNavigatePage;
  });

  useEffect(() => {
    pageTextCache.current.clear();
  }, [doc]);

  const setQuery = useCallback((nextQuery: string) => {
    setQueryState(nextQuery);
    if (!nextQuery.trim()) {
      setRawMatches([]);
      setActiveIndex(0);
      setSearching(false);
    } else {
      setSearching(true);
    }
  }, []);

  useEffect(() => {
    const needle = query.trim();
    if (!open || !needle || !doc || !doc.getPage || numPages < 1) {
      return;
    }

    let cancelled = false;

    const runSearch = async () => {
      const found: PdfSearchMatch[] = [];
      for (let p = 1; p <= numPages; p += 1) {
        if (cancelled) return;
        let text = pageTextCache.current.get(p);
        if (text === undefined) {
          try {
            const page = await doc.getPage!(p);
            const content = page.getTextContent ? await page.getTextContent() : { items: [] };
            text = content.items
              .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
              .join(' ');
            pageTextCache.current.set(p, text);
          } catch {
            text = '';
          }
        }
        const hits = countOccurrences(text, needle);
        for (let occ = 0; occ < hits; occ += 1) {
          found.push({ pageNumber: p, occurrence: occ });
        }
      }
      if (cancelled) return;
      setRawMatches(found);
      setActiveIndex(0);
      setSearching(false);
      if (found.length > 0 && found[0]) {
        navigateRef.current(found[0].pageNumber);
      }
    };

    void runSearch();
    return () => {
      cancelled = true;
    };
  }, [doc, numPages, open, query]);

  const matches = useMemo(
    () => (open && query.trim() ? rawMatches : []),
    [open, query, rawMatches],
  );

  const nextMatch = useCallback(() => {
    if (matches.length === 0) return;
    const next = (activeIndex + 1) % matches.length;
    setActiveIndex(next);
    const target = matches[next];
    if (target) navigateRef.current(target.pageNumber);
  }, [activeIndex, matches]);

  const prevMatch = useCallback(() => {
    if (matches.length === 0) return;
    const prev = (activeIndex - 1 + matches.length) % matches.length;
    setActiveIndex(prev);
    const target = matches[prev];
    if (target) navigateRef.current(target.pageNumber);
  }, [activeIndex, matches]);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQueryState('');
    setRawMatches([]);
    setActiveIndex(0);
    setSearching(false);
  }, []);

  return {
    open,
    setOpen,
    query,
    setQuery,
    matches,
    activeIndex,
    searching,
    nextMatch,
    prevMatch,
    closeSearch,
  };
}
