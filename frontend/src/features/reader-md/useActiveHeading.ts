import { useEffect, useState, type RefObject } from 'react';

/** A heading counts as current once its top has passed this line (px from the viewport top). */
const CURRENT_LINE_PX = 120;

/**
 * Source line of the heading being read (the last H1-H4 above the fold line), or null
 * before the first one. Recomputed on scroll, like the legacy `markOutline`.
 */
export function useActiveHeading(article: RefObject<HTMLElement | null>, html: string): number | null {
  const [line, setLine] = useState<number | null>(null);

  useEffect(() => {
    const root = article.current;
    if (!root) return;
    const headings = Array.from(root.querySelectorAll<HTMLElement>('[id^="L"]')).filter((element) =>
      /^H[1-4]$/.test(element.tagName),
    );
    const mark = () => {
      let current: number | null = null;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= CURRENT_LINE_PX) {
          current = parseInt(heading.id.slice(1), 10);
        } else break;
      }
      setLine(current);
    };
    const frame = requestAnimationFrame(mark);
    window.addEventListener('scroll', mark, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', mark);
    };
  }, [article, html]);

  return line;
}
