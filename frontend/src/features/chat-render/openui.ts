/*
 * Lightweight, zero-dependency OpenUI parser and schema definitions inspired by
 * https://github.com/thesysdev/openui. Parses fenced ```openui JSON blocks into
 * strongly-typed question-adaptive UI specs, with streaming-tolerant fallback.
 */
import { bookHref } from './links';

export interface SkillItem {
  name: string;
  level: number;
  status?: 'focus' | 'done' | 'review';
  note?: string;
}

export interface SkillMapBlock {
  component: 'SkillMap';
  topic: string;
  book?: string;
  focus?: string;
  skills: SkillItem[];
}

export interface ConceptCardBlock {
  component: 'ConceptCard';
  title: string;
  subtitle?: string;
  book?: string;
  intuition?: string;
  formal?: string;
  example?: string;
  takeaways?: string[];
}

export interface ComparisonTableBlock {
  component: 'ComparisonTable';
  title?: string;
  columns: string[];
  rows: string[][];
  verdict?: string;
}

export interface WalkthroughStep {
  title: string;
  detail: string;
  formula?: string;
  cite?: string;
}

export interface StepWalkthroughBlock {
  component: 'StepWalkthrough';
  title: string;
  steps: WalkthroughStep[];
}

export interface BookRecommendation {
  book: string;
  title?: string;
  category?: string;
  why: string;
  start?: string;
}

export interface BookListBlock {
  component: 'BookList';
  title?: string;
  books: BookRecommendation[];
}

export interface QuizCheckBlock {
  component: 'QuizCheck';
  question: string;
  hint?: string;
  options?: string[];
}

export type OpenUISpec =
  | SkillMapBlock
  | ConceptCardBlock
  | ComparisonTableBlock
  | StepWalkthroughBlock
  | BookListBlock
  | QuizCheckBlock;

export type ParsedOpenUI =
  | { status: 'ready'; spec: OpenUISpec }
  | { status: 'streaming'; component?: string }
  | { status: 'invalid'; raw: string };

function asString(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val.trim() : fallback;
}

function asStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.map((item) => asString(item)).filter(Boolean);
}

function clampLevel(val: unknown): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(5, Math.round(num)));
}

/** Convert an inline citation string like `shelf/book.pdf#p12` or `notes.md#L40` into a reader href. */
export function citationToHref(cite: string): string | null {
  const trimmed = cite.trim();
  if (!trimmed) return null;
  const match = /^([^\s#]+\.(?:pdf|md))(?:#(?:p(\d+)|L(\d+)))?$/i.exec(trimmed);
  if (!match) return null;
  const [, book = '', pageStr, lineStr] = match;
  return bookHref({
    book,
    page: pageStr ? Number(pageStr) : null,
    line: lineStr ? Number(lineStr) : null,
  });
}

export function parseOpenUIBlock(raw: string, closed = true): ParsedOpenUI {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { status: 'streaming' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    if (!closed) {
      const compMatch = /"component"\s*:\s*"([^"]+)"/.exec(trimmed);
      return { status: 'streaming', component: compMatch?.[1] };
    }
    return { status: 'invalid', raw: trimmed };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'invalid', raw: trimmed };
  }

  const obj = parsed as Record<string, unknown>;
  const component = asString(obj.component);

  switch (component) {
    case 'SkillMap': {
      const rawSkills = Array.isArray(obj.skills) ? obj.skills : [];
      const skills: SkillItem[] = rawSkills
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => {
          const rawStatus = asString(item.status);
          const status =
            rawStatus === 'focus' || rawStatus === 'done' || rawStatus === 'review'
              ? rawStatus
              : undefined;
          return {
            name: asString(item.name, 'Subskill'),
            level: clampLevel(item.level),
            status,
            note: asString(item.note) || undefined,
          };
        });
      return {
        status: 'ready',
        spec: {
          component: 'SkillMap',
          topic: asString(obj.topic, 'Socratic Skill Map'),
          book: asString(obj.book) || undefined,
          focus: asString(obj.focus) || undefined,
          skills,
        },
      };
    }

    case 'ConceptCard': {
      const title = asString(obj.title);
      if (!title) return { status: 'invalid', raw: trimmed };
      return {
        status: 'ready',
        spec: {
          component: 'ConceptCard',
          title,
          subtitle: asString(obj.subtitle) || undefined,
          book: asString(obj.book) || undefined,
          intuition: asString(obj.intuition) || undefined,
          formal: asString(obj.formal) || undefined,
          example: asString(obj.example) || undefined,
          takeaways: asStringArray(obj.takeaways),
        },
      };
    }

    case 'ComparisonTable': {
      const columns = asStringArray(obj.columns);
      const rawRows = Array.isArray(obj.rows) ? obj.rows : [];
      const rows = rawRows
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => row.map((cell) => String(cell ?? '').trim()));
      if (columns.length === 0 && rows.length === 0) {
        return { status: 'invalid', raw: trimmed };
      }
      return {
        status: 'ready',
        spec: {
          component: 'ComparisonTable',
          title: asString(obj.title) || undefined,
          columns,
          rows,
          verdict: asString(obj.verdict) || undefined,
        },
      };
    }

    case 'StepWalkthrough': {
      const rawSteps = Array.isArray(obj.steps) ? obj.steps : [];
      const steps: WalkthroughStep[] = rawSteps
        .filter((step): step is Record<string, unknown> => Boolean(step && typeof step === 'object'))
        .map((step, idx) => ({
          title: asString(step.title, `Step ${idx + 1}`),
          detail: asString(step.detail),
          formula: asString(step.formula) || undefined,
          cite: asString(step.cite) || undefined,
        }));
      if (steps.length === 0) return { status: 'invalid', raw: trimmed };
      return {
        status: 'ready',
        spec: {
          component: 'StepWalkthrough',
          title: asString(obj.title, 'Step-by-Step Walkthrough'),
          steps,
        },
      };
    }

    case 'BookList': {
      const rawBooks = Array.isArray(obj.books) ? obj.books : [];
      const books: BookRecommendation[] = rawBooks
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          book: asString(item.book),
          title: asString(item.title) || undefined,
          category: asString(item.category) || undefined,
          why: asString(item.why),
          start: asString(item.start) || undefined,
        }))
        .filter((item) => Boolean(item.book || item.title));
      if (books.length === 0) return { status: 'invalid', raw: trimmed };
      return {
        status: 'ready',
        spec: {
          component: 'BookList',
          title: asString(obj.title) || undefined,
          books,
        },
      };
    }

    case 'QuizCheck': {
      const question = asString(obj.question);
      if (!question) return { status: 'invalid', raw: trimmed };
      return {
        status: 'ready',
        spec: {
          component: 'QuizCheck',
          question,
          hint: asString(obj.hint) || undefined,
          options: asStringArray(obj.options),
        },
      };
    }

    default:
      return { status: 'invalid', raw: trimmed };
  }
}
