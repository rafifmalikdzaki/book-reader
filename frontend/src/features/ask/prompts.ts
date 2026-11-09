/*
 * Ready-made prompts for the Ask empty state. Clicking one fills the composer. Wording matters:
 * AskPage switches to Socratic Tutor mode when a prompt matches /tutor|socratic|quiz me/, so only
 * the tutor prompts may use those words.
 */
export const BOOK_PROMPTS = [
  'Summarize this page',
  'Find related passages in this book',
  'What does this section argue?',
  'Tutor me on this section',
];

export const LIBRARY_PROMPTS = [
  'Find passages about a topic',
  'Compare two books',
  'Trace an idea across the library',
  'Teach me a topic Socratically',
];

export const OPENUI_SHOWCASE = [
  {
    badge: 'ConceptCard',
    title: 'Concept Breakdown',
    desc: 'Intuition, formal math & worked example',
    prompt: 'Break down a core concept from my library with intuition, formal math, and a ConceptCard',
  },
  {
    badge: 'ConceptGraph',
    title: 'Architecture & Flow',
    desc: 'Interactive node-link diagram of dependencies',
    prompt: 'Map the key concepts and their dependencies as an interactive ConceptGraph',
  },
  {
    badge: 'ComparisonTable',
    title: 'Trade-off Matrix',
    desc: 'Side-by-side comparison across methods or books',
    prompt: 'Compare two approaches or algorithms in my library using a ComparisonTable',
  },
  {
    badge: 'StepWalkthrough',
    title: 'Step-by-step Derivation',
    desc: 'Numbered steps with formulas and page citations',
    prompt: 'Walk me through one derivation or algorithm from my library as a StepWalkthrough',
  },
  {
    badge: 'Chart',
    title: 'Numbers at a Glance',
    desc: 'Bar comparison of a metric reported in the text',
    prompt: 'Find a benchmark or metric reported in my books and plot it as a Chart',
  },
  {
    badge: 'BookList',
    title: 'Reading Path',
    desc: 'Which books to open, why, and where to start',
    prompt: 'Recommend books from my library to learn one topic, as a BookList with where to start',
  },
  {
    badge: 'QuizCheck',
    title: 'Check Question',
    desc: 'One multiple-choice question with a hint',
    prompt: 'Ask me one multiple-choice check question about a concept in my library, as a QuizCheck',
  },
  {
    badge: 'SkillMap',
    title: 'Socratic Mastery',
    desc: '0–5 subskill diagnostic & one question per turn',
    prompt: 'Tutor me Socratically with a diagnostic SkillMap and one question at a time',
  },
] as const;

/**
 * One prompt that exercises everything in a single answer: tool-backed search with citations,
 * LaTeX, and each visual block. It avoids the tutor trigger words so it runs in Explain mode;
 * the SkillMap/tutor flow has its own card.
 */
export function tourPrompt(aboutBook: boolean): string {
  const scope = aboutBook
    ? 'this book: read its outline and the section I am on'
    : 'my library: search it and pick one topic that appears in my books';
  return [
    `Give me a guided tour of everything you can do, using ${scope}.`,
    'In a single answer, in this order, with a sentence or two of prose between blocks:',
    '1. Cite the exact pages or lines you used, like book.pdf#p12.',
    '2. Explain the topic in a ConceptCard, with one key formula in LaTeX.',
    '3. Compare two approaches in a ComparisonTable.',
    '4. Walk through one derivation or algorithm as a StepWalkthrough.',
    '5. Map how the ideas connect in a ConceptGraph.',
    '6. Plot one number the text reports as a Chart (skip this if the text has no numbers).',
    '7. Point me to where to read more in a BookList.',
    '8. End with one multiple-choice QuizCheck question.',
  ].join('\n');
}
