import type { NotepadNote } from '../../api/types';

/** "p.12 · § Methods · ¶ 3", "lines 40–44", or "unlocated" (port of notepad.js `locatorText`). */
export function locatorText(note: NotepadNote): string {
  const parts: string[] = [];
  if (note.kind === 'pdf' && note.page) parts.push(`p.${note.page}`);
  else if (note.line_start) {
    const end = note.line_end && note.line_end !== note.line_start ? `–${note.line_end}` : '';
    parts.push(`lines ${note.line_start}${end}`);
  } else parts.push('unlocated');
  if (note.section) parts.push(`§ ${note.section}`);
  if (note.paragraph) parts.push(`¶ ${note.paragraph}`);
  return parts.join(' · ');
}

/** Router path back to the source: `/book/<rel>#p12` (PDF) or `#L40` (Markdown). */
export function sourceHref(note: Pick<NotepadNote, 'book' | 'kind' | 'page' | 'line_start'>): string {
  const base = '/book/' + String(note.book || '').split('/').map(encodeURIComponent).join('/');
  if (note.kind === 'pdf' && note.page) return `${base}#p${note.page}`;
  if (note.line_start) return `${base}#L${note.line_start}`;
  return base;
}

export function bookFileName(book: string): string {
  return String(book || '').split('/').pop() ?? '';
}
