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

export interface GraphNode {
  id: string;
  label: string;
  group?: string;
  detail?: string;
  cite?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ConceptGraphBlock {
  component: 'ConceptGraph';
  title: string;
  subtitle?: string;
  book?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ChartItem {
  label: string;
  value: number;
  displayValue?: string;
  note?: string;
}

export interface ChartBlock {
  component: 'Chart';
  title: string;
  subtitle?: string;
  unit?: string;
  book?: string;
  items: ChartItem[];
  caption?: string;
}

export type OpenUISpec =
  | SkillMapBlock
  | ConceptCardBlock
  | ComparisonTableBlock
  | StepWalkthroughBlock
  | BookListBlock
  | QuizCheckBlock
  | ConceptGraphBlock
  | ChartBlock;

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

function sanitizeLenientJson(raw: string): string {
  return raw
    // Drop trailing commas, skipping string literals so ", ]" inside text survives.
    .replace(
      /("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g,
      (_match, str?: string, close?: string) => str ?? close ?? '',
    )
    .replace(
      /(?<!\\)\\(?=(?:frac|forall|flat|beta|binom|big|bar|bf|theta|tau|times|top|text|tilde|to|nabla|neq|nu|norm|not|rho|rightarrow|right)\b)/g,
      '\\\\',
    )
    .replace(/(?<!\\)\\(?![/\\"'bfnrtu])/g, '\\\\');
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
    const cleaned = sanitizeLenientJson(trimmed);
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      if (!closed) {
        const compMatch = /"component"\s*:\s*"([^"]+)"/.exec(trimmed);
        return { status: 'streaming', component: compMatch?.[1] };
      }
      return { status: 'invalid', raw: trimmed };
    }
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
      const title = asString(obj.title ?? obj.name);
      if (!title) return { status: 'invalid', raw: trimmed };
      return {
        status: 'ready',
        spec: {
          component: 'ConceptCard',
          title,
          subtitle: asString(obj.subtitle) || undefined,
          book: asString(obj.book ?? obj.cite) || undefined,
          intuition: asString(obj.intuition ?? obj.summary) || undefined,
          formal: asString(obj.formal ?? obj.math ?? obj.equation ?? obj.definition) || undefined,
          example: asString(obj.example ?? obj.worked_example) || undefined,
          takeaways: asStringArray(obj.takeaways ?? obj.key_takeaways ?? obj.points),
        },
      };
    }

    case 'ComparisonTable': {
      const columns = asStringArray(obj.columns ?? obj.headers);
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
          verdict: asString(obj.verdict ?? obj.summary ?? obj.takeaway) || undefined,
        },
      };
    }

    case 'StepWalkthrough': {
      const rawSteps = Array.isArray(obj.steps)
        ? obj.steps
        : Array.isArray(obj.items)
          ? obj.items
          : [];
      const steps: WalkthroughStep[] = rawSteps
        .map((step, idx): WalkthroughStep | null => {
          if (typeof step === 'string') {
            return { title: `Step ${idx + 1}`, detail: step.trim() };
          }
          if (step && typeof step === 'object') {
            const s = step as Record<string, unknown>;
            return {
              title: asString(s.title ?? s.name ?? s.step, `Step ${idx + 1}`),
              detail: asString(s.detail ?? s.description ?? s.explanation ?? s.text),
              formula: asString(s.formula ?? s.equation ?? s.math) || undefined,
              cite: asString(s.cite ?? s.book ?? s.source) || undefined,
            };
          }
          return null;
        })
        .filter((s): s is WalkthroughStep => s !== null);
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

    case 'ConceptGraph':
    case 'Graph':
    case 'Architecture': {
      const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
      const nodes: GraphNode[] = rawNodes
        .filter((n): n is Record<string, unknown> => Boolean(n && typeof n === 'object'))
        .map((n, idx) => {
          const id = asString(n.id, `n${idx + 1}`);
          return {
            id,
            label: asString(n.label || n.title || n.name, id),
            group: asString(n.group || n.category) || undefined,
            detail: asString(n.detail || n.description) || undefined,
            cite: asString(n.cite || n.book) || undefined,
          };
        });
      if (nodes.length === 0) return { status: 'invalid', raw: trimmed };
      const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];
      const edges: GraphEdge[] = rawEdges
        .filter((e): e is Record<string, unknown> => Boolean(e && typeof e === 'object'))
        .map((e) => ({
          from: asString(e.from || e.source),
          to: asString(e.to || e.target),
          label: asString(e.label || e.relation) || undefined,
        }))
        .filter((e) => Boolean(e.from && e.to));
      return {
        status: 'ready',
        spec: {
          component: 'ConceptGraph',
          title: asString(obj.title, 'Concept Architecture'),
          subtitle: asString(obj.subtitle) || undefined,
          book: asString(obj.book) || undefined,
          nodes,
          edges,
        },
      };
    }

    case 'Chart':
    case 'BarChart':
    case 'MetricChart': {
      const rawItems = Array.isArray(obj.items || obj.bars || obj.data)
        ? ((obj.items || obj.bars || obj.data) as unknown[])
        : [];
      const items: ChartItem[] = rawItems
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item, idx) => {
          const rawVal = Number(item.value ?? item.score ?? 0);
          return {
            label: asString(item.label || item.name, `Item ${idx + 1}`),
            value: Number.isFinite(rawVal) ? rawVal : 0,
            displayValue: asString(item.displayValue) || undefined,
            note: asString(item.note || item.detail) || undefined,
          };
        });
      if (items.length === 0) return { status: 'invalid', raw: trimmed };
      return {
        status: 'ready',
        spec: {
          component: 'Chart',
          title: asString(obj.title, 'Metric Comparison'),
          subtitle: asString(obj.subtitle) || undefined,
          unit: asString(obj.unit) || undefined,
          book: asString(obj.book) || undefined,
          items,
          caption: asString(obj.caption) || undefined,
        },
      };
    }

    default:
      return { status: 'invalid', raw: trimmed };
  }
}
