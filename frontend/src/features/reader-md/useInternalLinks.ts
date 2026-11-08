import { useEffect, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';

/** In-app destinations of rewritten Markdown links; `/raw/` files stay ordinary downloads. */
function isAppPath(pathname: string): boolean {
  return pathname.startsWith('/book/') || pathname === '/ask';
}

/**
 * Delegated click handler for links inside the injected HTML: `/book/...` and `/ask`
 * go through the router (no reload); modified clicks, new-tab and external links do not.
 * Hrefs come percent-encoded from the server, so the path is passed on untouched.
 */
export function useInternalLinks(article: RefObject<HTMLElement | null>): void {
  const navigate = useNavigate();
  useEffect(() => {
    const root = article.current;
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest('a');
      if (!anchor || !root.contains(anchor)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin || !isAppPath(url.pathname)) return;
      event.preventDefault();
      void navigate(url.pathname + url.search + url.hash);
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [article, navigate]);
}
