import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { MOBILE_QUERY, useMediaQuery } from '../ui';
import styles from './Masthead.module.css';

/** Legacy shell.js debounce between a keystroke and the `?q=` update. */
export const SEARCH_DEBOUNCE_MS = 200;

const SEARCH_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);

/**
 * Masthead search field. On `/` it drives `?q=` / `?inside=1` (see `useLibrarySearchParams`);
 * elsewhere typing does nothing and Enter jumps to the library with a full-text search.
 */
export function SearchBox() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mobile = useMediaQuery(MOBILE_QUERY);
  const onLibrary = pathname === '/';
  const urlQ = onLibrary ? (params.get('q')?.trim() ?? '') : '';
  const inputRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState(urlQ);
  // `emitted` is the last term this box wrote; it stops a lagging URL render from
  // overwriting what was typed since. `seenQ` detects external URL changes.
  const [emitted, setEmitted] = useState(urlQ);
  const [seenQ, setSeenQ] = useState(urlQ);
  if (urlQ !== seenQ) {
    setSeenQ(urlQ);
    if (urlQ !== emitted) {
      setValue(urlQ);
      setEmitted(urlQ);
    }
  }

  const timer = useRef<number | null>(null);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);

  // Global keyboard shortcut: / or Cmd+K / Ctrl+K to jump to search
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isInput) return;

      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const write = (term: string, inside: boolean) => {
    const next = new URLSearchParams(params);
    if (term) next.set('q', term);
    else next.delete('q');
    if (term && inside) next.set('inside', '1');
    else next.delete('inside');
    setEmitted(term);
    setParams(next, { replace: true });
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    setValue(text);
    cancel();
    if (!onLibrary) return;
    timer.current = window.setTimeout(() => write(text.trim(), false), SEARCH_DEBOUNCE_MS);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const term = value.trim();
    if (!term) return;
    cancel();
    if (onLibrary) write(term, true);
    else navigate(`/?q=${encodeURIComponent(term)}&inside=1`);
  };

  const hasQuery = value.trim().length > 0;

  return (
    <div className={styles.searchWrapper}>
      <span aria-hidden="true" className={styles.searchIcon}>
        {SEARCH_ICON}
      </span>
      <input
        ref={inputRef}
        className={styles.search}
        id="global-search"
        type="search"
        value={value}
        placeholder={mobile ? 'Search…' : 'Search titles — Enter for text'}
        aria-label="Filter books by title, or press Enter to search inside books"
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
      {!mobile ? (
        <span aria-hidden="true" className={styles.searchBadge}>
          {hasQuery ? '↵' : '⌘K'}
        </span>
      ) : null}
    </div>
  );
}
