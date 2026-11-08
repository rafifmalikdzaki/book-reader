/*
 * Shared chat renderer (reader rail + Ask page). Public API:
 *
 *   <MarkdownAnswer text={string} />
 *   <ChatMessageView message={{role, content, sources?, provider?, model?}}
 *                    pending?={boolean} variant?={'bubble'|'thread'} className? />
 *   <SourceList sources={ChatSource[]} />
 *   <SmartLink href />                  react-router Link for SPA routes, <a> otherwise
 *   bookHref(source): string            "/book/<enc path>#p12" | "#L40"
 *   sourceLabel(source): string         "file.pdf · p.12 · § Section"
 *   isInternalHref(href): boolean       true for "/", "/book...", "/ask..." (use with <Link>)
 *   SAFE_HREF                           /^(https?:\/\/|\/(?!\/|\\)|#)/i
 *   ensureKatex(): Promise<void>        lazy-loads vendored /static/vendor/katex/* once
 *   renderMath(el), useKatex()          typeset an element / preload from a component
 *   parseMarkdown(text)                 pure parser (no DOM)
 *
 * Math safety: KaTeX rewrites DOM, so text that may hold LaTeX is rendered by `MathText`,
 * an empty React-owned <span> whose content is written with `textContent` and typeset by
 * auto-render (trust:false, throwOnError:false, strict:"ignore"). React never owns those
 * child nodes, so re-renders cannot conflict with KaTeX. There is no innerHTML anywhere.
 */
export { ChatMessageView } from './ChatMessageView';
export type { ChatMessageData, ChatMessageViewProps } from './ChatMessageView';
export { MarkdownAnswer } from './MarkdownAnswer';
export { SourceList } from './SourceList';
export { SmartLink } from './SmartLink';
export { SAFE_HREF, bookHref, isInternalHref, sourceLabel } from './links';
export { ensureKatex, renderMath, useKatex } from './katex';
export { parseInline, parseMarkdown } from './markdown';
export type { Block, Inline } from './markdown';
