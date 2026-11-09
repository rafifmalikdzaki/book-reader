"""Markdown rendering, caching, search, and library-relative link rewriting."""

from __future__ import annotations

import posixpath
import threading
from collections import OrderedDict
from html import escape
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from markdown_it import MarkdownIt
from markdown_it.token import Token
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_by_name
from pygments.util import ClassNotFound

_FORMATTER = HtmlFormatter(nowrap=True)
_BOOK_SUFFIXES = {".pdf", ".md"}
_RENDER_CACHE_SIZE = 16
_RENDER_CACHE: OrderedDict[tuple[str, float, int], str] = OrderedDict()
_CACHE_LOCK = threading.Lock()


def render_markdown_file(path: Path, *, file_rel: str) -> str:
    """Render a Markdown file, reusing the HTML until the file changes."""
    stat = path.stat()
    key = (str(path), stat.st_mtime, stat.st_size)
    with _CACHE_LOCK:
        cached = _RENDER_CACHE.get(key)
        if cached is not None:
            _RENDER_CACHE.move_to_end(key)
            return cached
    rendered = render_markdown(
        path.read_text(encoding="utf-8", errors="replace"), file_rel=file_rel
    )
    with _CACHE_LOCK:
        _RENDER_CACHE[key] = rendered
        while len(_RENDER_CACHE) > _RENDER_CACHE_SIZE:
            _RENDER_CACHE.popitem(last=False)
    return rendered


def search_markdown(path: Path, query: str, limit: int = 200) -> list[dict[str, object]]:
    """Case-insensitive line search over a Markdown file."""
    needle = query.casefold().strip()
    if not needle:
        return []
    text = path.read_text(encoding="utf-8", errors="replace")
    hits: list[dict[str, object]] = []
    for number, line in enumerate(text.splitlines(), start=1):
        if needle in line.casefold():
            hits.append({"line": number, "snippet": line.strip()[:200]})
            if len(hits) >= limit:
                break
    return hits


_ANCHORED_TOKENS = {
    "paragraph_open",
    "heading_open",
    "list_item_open",
    "blockquote_open",
    "table_open",
}


def render_markdown(text: str, *, file_rel: str) -> str:
    """Render CommonMark to HTML; HTML passthrough stays disabled for safety."""
    md = MarkdownIt("commonmark", {"html": False, "linkify": False, "highlight": _highlight})
    md.enable("table").enable("strikethrough")
    tokens = md.parse(text)
    base_dir = posixpath.dirname(file_rel)
    _rewrite_all(tokens, base_dir)
    for token in tokens:
        if token.type in _ANCHORED_TOKENS and token.map:
            token.attrSet("id", f"L{token.map[0] + 1}")
    return str(md.renderer.render(tokens, md.options, {}))


def _highlight(code: str, lang: str, _attrs: str) -> str:
    """Return a full <pre> block, or "" so markdown-it escapes the code itself."""
    if not lang:
        return ""
    try:
        lexer = get_lexer_by_name(lang)
    except ClassNotFound:
        return ""
    body = highlight(code, lexer, _FORMATTER)
    return f'<pre><code class="language-{escape(lang, quote=True)}">{body}</code></pre>'


def _rewrite_all(tokens: list[Token], base_dir: str) -> None:
    """Link/image tokens are nested inside ``inline`` tokens' children."""
    for token in tokens:
        if token.children:
            _rewrite_all(token.children, base_dir)
        if token.type == "link_open":
            _rewrite(token, "href", base_dir)
        elif token.type == "image":
            _rewrite(token, "src", base_dir)


def _rewrite(token: Token, attribute: str, base_dir: str) -> None:
    raw = token.attrGet(attribute)
    if not isinstance(raw, str) or not raw:
        return
    target = raw
    split = urlsplit(target)
    if split.scheme or split.netloc or target.startswith("//"):
        return
    if not split.path:
        return  # pure fragment/query link: leave alone
    resolved = posixpath.normpath(posixpath.join(base_dir, unquote(split.path)))
    if resolved.startswith("..") or resolved.startswith("/"):
        return
    quoted = quote(resolved, safe="/@+~")
    url = (
        f"/book/{quoted}"
        if posixpath.splitext(resolved)[1].lower() in _BOOK_SUFFIXES
        else f"/raw/{quoted}"
    )
    if split.query:
        url += f"?{split.query}"
    if split.fragment:
        url += f"#{split.fragment}"
    token.attrSet(attribute, url)
