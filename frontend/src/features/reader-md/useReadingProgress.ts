import { useEffect, useState } from 'react';

import { postProgress } from '../../api/endpoints';

/** Same debounce as the inline script in book_md.html. */
export const PROGRESS_DEBOUNCE_MS = 400;

/** Scrolled fraction of the page, 0..1. */
export function scrollRatio(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}

interface Options {
  path: string;
  /** Saved ratio to return to; 0 or null leaves the page where it is. */
  restore: number | null;
  /** True when a `#L<n>` deep link owns the initial position (it beats the saved ratio). */
  skipRestore: boolean;
}

/**
 * Window-scroll reading position: restores the saved ratio once, reports the percent read
 * and saves the ratio 400 ms after the last scroll. The document is the scroller.
 */
export function useReadingProgress({ path, restore, skipRestore }: Options): number {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    const refresh = () => setPercent(Math.round(scrollRatio() * 100));
    const save = () => {
      postProgress({ path, scroll: scrollRatio() }).catch(() => undefined);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interacted = false;
    const markInteraction = () => {
      interacted = true;
    };
    const onScroll = () => {
      refresh();
      if (!interacted) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        save();
      }, PROGRESS_DEBOUNCE_MS);
    };

    // The initial restore/top position is programmatic; only a wheel, touch, pointer or key
    // interaction makes a scroll event eligible to save, so the restored clamp is not posted.
    window.addEventListener('wheel', markInteraction, { passive: true });
    window.addEventListener('touchstart', markInteraction, { passive: true });
    window.addEventListener('pointerdown', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction);
    window.addEventListener('scroll', onScroll, { passive: true });
    const frame = requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (!skipRestore) {
        if (restore && restore > 0 && max > 0) window.scrollTo(0, restore * max);
        else window.scrollTo(0, 0);
      }
      refresh();
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('wheel', markInteraction);
      window.removeEventListener('touchstart', markInteraction);
      window.removeEventListener('pointerdown', markInteraction);
      window.removeEventListener('keydown', markInteraction);
      window.removeEventListener('scroll', onScroll);
      if (timer !== undefined) {
        clearTimeout(timer);
        save();
      }
    };
  }, [path, restore, skipRestore]);

  return percent;
}
