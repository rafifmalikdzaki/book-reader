/*
 * Pure port of the chat_render.js mini-Markdown parser: text in, plain data out. It never
 * touches the DOM, so the React renderer builds elements from this and nothing is ever
 * parsed as HTML. Supports headings, blockquotes, pipe tables, lists, openui blocks,
 * inline citations (book.pdf#p12 / notes.md#L40), bold, inline code, links, and LaTeX.
 */
import { SAFE_HREF } from './links';
import { citationToHref } from './openui';

export type Inline =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; href: string; label: string };

export type Block =
  | { kind: 'fence'; code: string; lang?: string; closed?: boolean }
  | { kind: 'openui'; code: string; closed: boolean }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; children: Inline[] }
  | { kind: 'blockquote'; lines: Inline[][] }
  | { kind: 'table'; headers: Inline[][]; rows: Inline[][][] }
  | { kind: 'math'; text: string }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'paragraph'; lines: Inline[][] };

const INLINE =
  /(\*\*|__)(.+?)\1|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\\/\w])([\w./-]+\.(?:pdf|md)#(?:p\d+|L\d+))\b/;
const FENCE = /^\s*```(\w*)\s*$/;
const HEADING = /^\s*(#{1,4})\s+(.+?)\s*$/;
const BLOCKQUOTE = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP = /^\s*\|[\s:|-]+\|\s*$/;
const MATH_BLOCK = /\$\$|\\\[/;
const BULLET = /^\s*[-*]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const MARKER = /^\s*(?:[-*]|\d+[.)])\s+/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      out.push({ kind: 'text', value: rest });
      break;
    }
    if (match.index) out.push({ kind: 'text', value: rest.slice(0, match.index) });
    const [whole, , bold, code, label, href, rawCite] = match;
    if (bold !== undefined) {
      out.push({ kind: 'strong', children: parseInline(bold) });
    } else if (code !== undefined) {
      const citeHref = citationToHref(code);
      if (citeHref && code.includes('#')) {
        out.push({ kind: 'link', href: citeHref, label: code });
      } else {
        out.push({ kind: 'code', value: code });
      }
    } else if (label !== undefined && href !== undefined) {
      // Unsafe schemes (javascript:, data:, //host) degrade to the label as plain text.
      out.push(
        SAFE_HREF.test(href) ? { kind: 'link', href, label } : { kind: 'text', value: label },
      );
    } else if (rawCite !== undefined) {
      const citeHref = citationToHref(rawCite);
      if (citeHref) {
        out.push({ kind: 'link', href: citeHref, label: rawCite });
      } else {
        out.push({ kind: 'text', value: rawCite });
      }
    }
    rest = rest.slice(match.index + whole.length);
  }
  return out;
}

function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fenced = false;
  const flush = () => {
    if (current.length) blocks.push(current.join('\n'));
    current = [];
  };
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      if (!fenced) flush();
      current.push(line);
      fenced = !fenced;
      if (!fenced) flush();
      continue;
    }
    if (fenced) {
      current.push(line);
    } else if (line.trim() === '') {
      flush();
    } else if (HEADING.test(line)) {
      flush();
      blocks.push(line);
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks;
}

function parseTableCells(line: string): Inline[][] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((cell) => parseInline(cell.trim()));
}

export function parseMarkdown(text: string): Block[] {
  return splitBlocks(String(text)).map((block): Block => {
    const lines = block.split('\n');
    const fenceMatch = FENCE.exec(lines[0] ?? '');
    if (fenceMatch) {
      const lang = (fenceMatch[1] ?? '').toLowerCase();
      const closed = lines.length > 1 && lines.at(-1)?.trim() === '```';
      const code = lines.slice(1, closed ? -1 : undefined).join('\n');
      if (lang === 'openui' || lang === 'ui') {
        return { kind: 'openui', code, closed };
      }
      return { kind: 'fence', code, lang: lang || undefined, closed };
    }
    if (lines.length === 1) {
      const headingMatch = HEADING.exec(lines[0] ?? '');
      if (headingMatch) {
        const level = Math.min(4, Math.max(1, (headingMatch[1] ?? '#').length)) as 1 | 2 | 3 | 4;
        return { kind: 'heading', level, children: parseInline(headingMatch[2] ?? '') };
      }
    }
    if (
      lines.length >= 2 &&
      TABLE_ROW.test(lines[0] ?? '') &&
      TABLE_SEP.test(lines[1] ?? '') &&
      lines.slice(2).every((line) => TABLE_ROW.test(line))
    ) {
      return {
        kind: 'table',
        headers: parseTableCells(lines[0] ?? ''),
        rows: lines.slice(2).map(parseTableCells),
      };
    }
    if (lines.every((line) => BLOCKQUOTE.test(line))) {
      return {
        kind: 'blockquote',
        lines: lines.map((line) => parseInline(line.replace(BLOCKQUOTE, '$1'))),
      };
    }
    if (MATH_BLOCK.test(block)) return { kind: 'math', text: block };
    const bulleted = lines.every((line) => BULLET.test(line));
    const numbered = lines.every((line) => NUMBER.test(line));
    if (bulleted || numbered) {
      return {
        kind: 'list',
        ordered: !bulleted,
        items: lines.map((line) => parseInline(line.replace(MARKER, ''))),
      };
    }
    return { kind: 'paragraph', lines: lines.map(parseInline) };
  });
}
