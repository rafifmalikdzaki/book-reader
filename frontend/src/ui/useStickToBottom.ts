import { useCallback, useEffect, useRef } from 'react';

/** How close to the bottom (px) still counts as "following" the latest output. */
const NEAR_BOTTOM = 80;

/**
 * Keep a scrolling log pinned to its newest content, but only while the reader is following it.
 * Scrolling up unpins; scrolling back near the bottom re-pins. `signal` changes whenever new
 * content arrives; a changed truthy `forceKey` (e.g. the user just sent a message) re-pins.
 */
export function useStickToBottom<T extends HTMLElement>(signal: unknown, forceKey?: unknown) {
  const ref = useRef<T>(null);
  const pinned = useRef(true);

  const onScroll = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight <= NEAR_BOTTOM;
  }, []);

  useEffect(() => {
    if (forceKey) pinned.current = true;
  }, [forceKey]);

  useEffect(() => {
    const node = ref.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [signal, forceKey]);

  return { ref, onScroll };
}
