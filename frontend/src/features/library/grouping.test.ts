import { describe, expect, it } from 'vitest';

import { groupByFacet } from './grouping';
import { makeBook } from './testHarness';
import { byline, type BookMeta } from './useBookMeta';

const meta = (overrides: Partial<BookMeta>): BookMeta => ({
  authors: [],
  year: '',
  tags: [],
  collections: [],
  zotero: null,
  ...overrides,
});

describe('groupByFacet', () => {
  const books = ['a', 'b', 'c', 'd'].map((rel) => makeBook({ rel, title: rel }));
  const tags: Record<string, string[]> = {
    a: ['Rare', 'Machine Learning'],
    b: ['machine learning'],
    c: ['Optimization', 'Machine Learning'],
    d: [],
  };
  const metaFor = (rel: string) => meta({ tags: tags[rel] ?? [] });

  it('puts each book under its most shared tag, largest group first, untagged last', () => {
    const groups = groupByFacet(books, 'tag', metaFor);
    expect(groups.map((group) => [group.name, group.books.map((book) => book.rel)])).toEqual([
      ['Machine Learning', ['a', 'b', 'c']],
      ['Untagged', ['d']],
    ]);
  });

  it('groups by Zotero collection with its own fallback label', () => {
    const groups = groupByFacet(books, 'collection', (rel) =>
      meta({ collections: rel === 'a' ? ['Thesis'] : [] }),
    );
    expect(groups.map((group) => group.name)).toEqual(['Thesis', 'Not in a collection']);
  });
});

describe('byline', () => {
  it('shortens author lists and appends the year', () => {
    expect(byline(meta({ authors: ['Ashish Vaswani'], year: '2017' }))).toBe('Vaswani · 2017');
    expect(byline(meta({ authors: ['Grace Hopper', 'Alan Turing'] }))).toBe('Hopper & Turing');
    expect(byline(meta({ authors: ['A One', 'B Two', 'C Three'], year: '2020' }))).toBe(
      'One et al. · 2020',
    );
    expect(byline(meta({}))).toBe('');
  });
});
