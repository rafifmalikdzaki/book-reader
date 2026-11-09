/*
 * The OpenUI component library for chat answers. The Zod schemas are the single source of truth:
 * they validate what the model writes, type the props, and generate the system prompt
 * (`npm run gen:openui-prompt`). Prop key order is the positional argument order in OpenUI Lang,
 * so required props come first.
 */
import { createLibrary, defineComponent } from '@openuidev/react-lang';
import type { PromptOptions } from '@openuidev/lang-core';
import { z } from 'zod/v4';

import { BookListView } from './components/BookList';
import { ChartView } from './components/Chart';
import { ComparisonTableView } from './components/ComparisonTable';
import { ConceptCardView } from './components/ConceptCard';
import { ConceptGraphView } from './components/ConceptGraph';
import { QuizCheckView } from './components/QuizCheck';
import { SkillMapView } from './components/SkillMap';
import { StepWalkthroughView } from './components/StepWalkthrough';
import { usePrompt } from './promptContext';

const cite = z
  .string()
  .describe('Locator of the source passage, e.g. "shelf/book.pdf#p12" or "notes.md#L40".');

export const skillItem = z.object({
  name: z.string(),
  level: z.number().describe('Mastery 0-5.'),
  status: z.enum(['focus', 'done', 'review']).optional(),
  note: z.string().optional(),
});
export const walkthroughStep = z.object({
  title: z.string(),
  detail: z.string(),
  formula: z.string().optional().describe('LaTeX without surrounding dollar signs.'),
  cite: cite.optional(),
});
export const graphNode = z.object({
  id: z.string(),
  label: z.string(),
  group: z.string().optional(),
  detail: z.string().optional(),
  cite: cite.optional(),
});
export const graphEdge = z.object({
  from: z.string().describe('Node id.'),
  to: z.string().describe('Node id.'),
  label: z.string().optional(),
});
export const chartItem = z.object({
  label: z.string(),
  value: z.number(),
  displayValue: z.string().optional().describe('Formatted value, e.g. "85 ms".'),
  note: z.string().optional(),
});
export const bookRecommendation = z.object({
  book: z.string().describe('Library path of the book, e.g. "shelf/book.pdf".'),
  why: z.string(),
  title: z.string().optional(),
  category: z.string().optional(),
  start: z.string().optional().describe('Where to start reading, e.g. "Section 2 (p.14)".'),
});

const SkillMap = defineComponent({
  name: 'SkillMap',
  description:
    'Socratic tutoring: a mastery map of 4-8 subskills for one topic. Use in tutor mode and for "show progress".',
  props: z.object({
    topic: z.string(),
    skills: z.array(skillItem),
    focus: z.string().optional().describe('Name of the subskill being worked on now.'),
    book: cite.optional(),
  }),
  component: function SkillMapNode({ props }) {
    return <SkillMapView spec={{ component: 'SkillMap', ...props }} onPrompt={usePrompt()} />;
  },
});

const ConceptCard = defineComponent({
  name: 'ConceptCard',
  description:
    'Explain one concept or section: intuition, formal statement, worked example, takeaways. Use for "explain..." and "what is..." questions.',
  props: z.object({
    title: z.string(),
    intuition: z.string().optional(),
    formal: z.string().optional().describe('Formal statement; LaTeX with $...$ allowed.'),
    example: z.string().optional(),
    takeaways: z.array(z.string()).optional(),
    subtitle: z.string().optional(),
    book: cite.optional(),
  }),
  component: function ConceptCardNode({ props }) {
    return <ConceptCardView spec={{ component: 'ConceptCard', ...props }} onPrompt={usePrompt()} />;
  },
});

const ComparisonTable = defineComponent({
  name: 'ComparisonTable',
  description: 'Side-by-side comparison or trade-offs. Every row has one cell per column.',
  props: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number()]))),
    title: z.string().optional(),
    verdict: z.string().optional().describe('One-sentence synthesis.'),
  }),
  component: function ComparisonTableNode({ props }) {
    return (
      <ComparisonTableView
        spec={{
          component: 'ComparisonTable',
          ...props,
          rows: props.rows.map((row) => row.map((cell) => String(cell))),
        }}
      />
    );
  },
});

const StepWalkthrough = defineComponent({
  name: 'StepWalkthrough',
  description:
    'Ordered derivation or algorithm walkthrough with at least two steps. Use for "derive...", "walk me through...".',
  props: z.object({
    title: z.string(),
    steps: z.array(walkthroughStep),
  }),
  component: function StepWalkthroughNode({ props }) {
    return (
      <StepWalkthroughView
        spec={{ component: 'StepWalkthrough', ...props }}
        onPrompt={usePrompt()}
      />
    );
  },
});

const ConceptGraph = defineComponent({
  name: 'ConceptGraph',
  description:
    'Architecture or concept relationships as a node-link diagram with a clickable inspector. Use for "map the architecture...", "how do X, Y, Z connect".',
  props: z.object({
    title: z.string(),
    nodes: z.array(graphNode),
    edges: z.array(graphEdge),
    subtitle: z.string().optional(),
    book: cite.optional(),
  }),
  component: function ConceptGraphNode({ props }) {
    return (
      <ConceptGraphView spec={{ component: 'ConceptGraph', ...props }} onPrompt={usePrompt()} />
    );
  },
});

const Chart = defineComponent({
  name: 'Chart',
  description:
    'Horizontal bar comparison of one metric across items (benchmarks, scores). Use for "benchmark...", "plot...".',
  props: z.object({
    title: z.string(),
    items: z.array(chartItem),
    unit: z.string().optional(),
    caption: z.string().optional(),
    subtitle: z.string().optional(),
    book: cite.optional(),
  }),
  component: function ChartNode({ props }) {
    return <ChartView spec={{ component: 'Chart', ...props }} />;
  },
});

const BookList = defineComponent({
  name: 'BookList',
  description: 'Reading recommendations from the library. Use for "recommend books...", "which books cover...".',
  props: z.object({
    books: z.array(bookRecommendation),
    title: z.string().optional(),
  }),
  component: function BookListNode({ props }) {
    return <BookListView spec={{ component: 'BookList', ...props }} onPrompt={usePrompt()} />;
  },
});

const QuizCheck = defineComponent({
  name: 'QuizCheck',
  description: 'A short check question with optional answer choices and a hint. Clicking a choice sends it as the reply.',
  props: z.object({
    question: z.string(),
    options: z.array(z.string()).optional(),
    hint: z.string().optional(),
  }),
  component: function QuizCheckNode({ props }) {
    return <QuizCheckView spec={{ component: 'QuizCheck', ...props }} onPrompt={usePrompt()} />;
  },
});

const blocks = [
  SkillMap,
  ConceptCard,
  ComparisonTable,
  StepWalkthrough,
  ConceptGraph,
  Chart,
  BookList,
  QuizCheck,
];

const Answer = defineComponent({
  name: 'Answer',
  description: 'Root of every program: the visual blocks that accompany the written answer, in reading order.',
  props: z.object({
    blocks: z.array(z.union(blocks.map((block) => block.ref) as [typeof SkillMap.ref, ...(typeof SkillMap.ref)[]])),
  }),
  component: function AnswerNode({ props, renderNode }) {
    return <>{renderNode(props.blocks)}</>;
  },
});

export const openuiLibrary = createLibrary({
  root: 'Answer',
  components: [Answer, ...blocks],
});

export const openuiPromptOptions: PromptOptions = {
  inlineMode: true,
  preamble:
    'You are the research assistant of a personal book reader. You answer from the user\'s own library, using tools to search and read it. Write the answer itself as Markdown; add a visual block only when it clarifies the answer.',
  additionalRules: [
    'Write the explanation as normal Markdown outside the code fence. Put at most one openui-lang fence in an answer, and only when one of the components fits the question.',
    'Cite sources inline as shelf/book.pdf#p12 (PDF page) or notes.md#L40 (Markdown line). Use exactly the locators the tools returned.',
    'Use LaTeX for math: $...$ inline and $$...$$ for display. Inside string arguments, write backslashes as in LaTeX (e.g. "\\\\frac{a}{b}" is escaped once for the string).',
    'Always start the program with `root = Answer([...])` and list the blocks in reading order.',
  ],
  examples: [
    'root = Answer([card])\ncard = ConceptCard("Self-attention", "Each token looks up the others and mixes their values.", "softmax(QK^T / sqrt(d_k))V", "For 3 tokens the weights form a 3x3 matrix.", ["Parallel over positions", "Quadratic in length"], "Transformers", "shelf/attention.pdf#p12")',
    'root = Answer([graph])\ngraph = ConceptGraph("Retrieval pipeline", [{id: "q", label: "Query"}, {id: "r", label: "Retriever", group: "core", detail: "BM25 over pages", cite: "shelf/ir.pdf#p4"}, {id: "a", label: "Answer"}], [{from: "q", to: "r", label: "embeds"}, {from: "r", to: "a", label: "grounds"}])',
    'root = Answer([chart])\nchart = Chart("Latency", [{label: "Method A", value: 85, displayValue: "85 ms"}, {label: "Method B", value: 24, displayValue: "24 ms"}], "ms", "Lower is better.")',
  ],
};
