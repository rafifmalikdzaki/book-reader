import { useInRouterContext, Link } from 'react-router-dom';
import type { ReactNode } from 'react';

import { isInternalHref } from './links';

/**
 * Anchor for already-vetted hrefs: SPA routes go through react-router's `Link` (no page
 * reload) when a router is mounted; everything else is a plain `<a>`.
 */
export function SmartLink({
  href,
  children,
  className,
  title,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const inRouter = useInRouterContext();
  if (inRouter && isInternalHref(href)) {
    return (
      <Link to={href} rel="noreferrer" className={className} title={title}>
        {children}
      </Link>
    );
  }
  const external = /^https?:\/\//i.test(href);
  return (
    <a
      href={href}
      rel="noreferrer"
      target={external ? '_blank' : undefined}
      className={className}
      title={title}
    >
      {children}
    </a>
  );
}
