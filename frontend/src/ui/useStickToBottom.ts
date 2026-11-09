import { useCallback, useEffect, useRef } from 'react';

/** How close to the bottom (px) still counts as "following" the latest output. */
const NEAR_BOTTOM = 80;

/**
 * Keep a scrolling log pinned to its newest content, but only while the reader is following it.
 * Scrolling up unpins; scrolling back near the bottom re-pins. `signal` changes whenever new
 * content arrives; a changed truthy `forceKey` (e.g. the user just sent a message) re-pins, and
 * any change of `resetKey` (e.g. a different chat opened) re-pins and jumps to the bottom.
 * A truthy `topKey` anchors to the top instead (e.g. the empty-state hero, whose title a
 * bottom pin would clip when the content is taller than the viewport).
 */
export function useStickToBottom<T extends HTMLElement>(
  signal: unknown,
  forceKey?: unknown,
  resetKey?: unknown,
  topKey?: unknown,
) {
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
    pinned.current = true;
  }, [resetKey]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (topKey) node.scrollTop = 0;
    else if (pinned.current) node.scrollTop = node.scrollHeight;
  }, [signal, forceKey, resetKey, topKey]);

  return { ref, onScroll };
}
