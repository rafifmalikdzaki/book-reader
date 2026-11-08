/*
 * Pure port of the chat_render.js mini-Markdown parser: text in, plain data out. It never
 * touches the DOM, so the React renderer builds elements from this and nothing is ever
 * parsed as HTML.
 */
import { SAFE_HREF } from './links';

export type Inline =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; href: string; label: string };

export type Block =
  | { kind: 'fence'; code: string }
  | { kind: 'math'; text: string }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'paragraph'; lines: Inline[][] };

const INLINE = /(\*\*|__)(.+?)\1|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/;
const FENCE = /^\s*```(\w*)\s*$/;
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
    const [whole, , bold, code, label, href] = match;
    if (bold !== undefined) {
      out.push({ kind: 'strong', children: parseInline(bold) });
    } else if (code !== undefined) {
      out.push({ kind: 'code', value: code });
    } else if (label !== undefined && href !== undefined) {
      // Unsafe schemes (javascript:, data:, //host) degrade to the label as plain text.
      out.push(
        SAFE_HREF.test(href) ? { kind: 'link', href, label } : { kind: 'text', value: label },
      );
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
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks;
}

export function parseMarkdown(text: string): Block[] {
  return splitBlocks(String(text))
    .map((block): Block => {
      const lines = block.split('\n');
      if (FENCE.test(lines[0] ?? '')) {
        const closed = lines.at(-1)?.trim() === '```';
        return { kind: 'fence', code: lines.slice(1, closed ? -1 : undefined).join('\n') };
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
