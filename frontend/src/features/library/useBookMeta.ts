import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getPaperKeywords, getZotero } from '../../api/endpoints';
import type { ZoteroMeta, ZoteroResponse } from '../../api/types';

export const ZOTERO_KEY = ['library', 'zotero'] as const;
export const KEYWORDS_KEY = ['library', 'keywords'] as const;

/** Bibliographic facts about one book, merged from Zotero and the PDF's own metadata. */
export interface BookMeta {
  authors: string[];
  year: string;
  tags: string[];
  collections: string[];
  zotero: ZoteroMeta | null;
}

const EMPTY: BookMeta = { authors: [], year: '', tags: [], collections: [], zotero: null };

export interface BookMetaIndex {
  metaFor: (rel: string) => BookMeta;
  zotero: ZoteroResponse | undefined;
  hasTags: boolean;
  hasCollections: boolean;
}

/** Zotero files arXiv subjects as "Computer Science - Machine Learning"; the field is noise here. */
const ARCHIVE_PREFIX =
  /^(?:Computer Science|Statistics|Mathematics|Physics|Quantitative Biology|Quantitative Finance|Economics|Electrical Engineering and Systems Science) - /;

export function tidyTag(tag: string): string {
  return tag.replace(ARCHIVE_PREFIX, '').trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Zotero items and embedded PDF keywords for the library. Both sources are optional: when
 * an endpoint is missing or fails, books simply carry no extra metadata.
 */
export function useBookMeta(): BookMetaIndex {
  const zotero = useQuery({
    queryKey: ZOTERO_KEY,
    queryFn: () => getZotero(),
    staleTime: 60_000,
    retry: false,
  });
  const keywords = useQuery({
    queryKey: KEYWORDS_KEY,
    queryFn: () => getPaperKeywords(),
    staleTime: 60_000,
    retry: false,
  });

  return useMemo(() => {
    const index = new Map<string, BookMeta>();
    for (const [rel, paper] of Object.entries(keywords.data?.books ?? {})) {
      index.set(rel, { ...EMPTY, authors: paper.authors, tags: unique(paper.keywords.map(tidyTag)) });
    }
    for (const [rel, item] of Object.entries(zotero.data?.books ?? {})) {
      const embedded = index.get(rel) ?? EMPTY;
      index.set(rel, {
        authors: item.creators.length ? item.creators : embedded.authors,
        year: item.year,
        tags: unique([...item.tags, ...embedded.tags].map(tidyTag)),
        collections: item.collections,
        zotero: item,
      });
    }
    let hasTags = false;
    let hasCollections = false;
    for (const meta of index.values()) {
      hasTags ||= meta.tags.length > 0;
      hasCollections ||= meta.collections.length > 0;
    }
    return {
      metaFor: (rel: string) => index.get(rel) ?? EMPTY,
      zotero: zotero.data,
      hasTags,
      hasCollections,
    };
  }, [keywords.data, zotero.data]);
}

/** "Vaswani et al. · 2017", "Hopper & Turing", or "" when nothing is known. */
export function byline(meta: BookMeta): string {
  const surnames = meta.authors.map((name) => name.trim().split(/\s+/).pop() ?? name);
  let who = '';
  if (surnames.length === 1) who = surnames[0] ?? '';
  else if (surnames.length === 2) who = `${surnames[0]} & ${surnames[1]}`;
  else if (surnames.length > 2) who = `${surnames[0]} et al.`;
  return [who, meta.year].filter(Boolean).join(' · ');
}
