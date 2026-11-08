import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { MOBILE_QUERY, useMediaQuery } from '../ui';
import styles from './Masthead.module.css';

/** Legacy shell.js debounce between a keystroke and the `?q=` update. */
export const SEARCH_DEBOUNCE_MS = 200;

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

  return (
    <input
      className={styles.search}
      id="global-search"
      type="search"
      value={value}
      placeholder={mobile ? 'Search…' : 'Search titles — Enter for full text'}
      aria-label="Filter books by title, or press Enter to search inside books"
      onChange={onChange}
      onKeyDown={onKeyDown}
    />
  );
}
