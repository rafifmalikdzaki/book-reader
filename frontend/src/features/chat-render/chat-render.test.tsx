import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KATEX_OPTIONS } from './katex';
import { ChatMessageView, MarkdownAnswer, SourceList, bookHref, isInternalHref, sourceLabel } from '.';

const typeset = vi.fn<(root: HTMLElement, options: unknown) => void>();

beforeEach(() => {
  typeset.mockReset();
  window.renderMathInElement = typeset as typeof window.renderMathInElement;
});

afterEach(() => {
  delete window.renderMathInElement;
});

describe('MarkdownAnswer', () => {
  it('renders unsafe hrefs as plain text and safe external links in a new tab', () => {
    render(
      <MarkdownAnswer text="[bad](javascript:alert) [evil](//evil.test/x) [slash](/\\evil.test/x) [ok](https://example.test/a) [rel](/static/x)" />,
    );
    expect(screen.getByText(/bad/)).toBeInTheDocument();
    expect(screen.getByText(/evil/)).toBeInTheDocument();
    expect(screen.getByText(/slash/)).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://example.test/a',
      '/static/x',
    ]);
    expect(links[0]).toHaveAttribute('rel', 'noreferrer');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[1]).not.toHaveAttribute('target');
  });

  it('keeps script and markup as inert text', () => {
    const { container } = render(
      <MarkdownAnswer text={'<script>alert(1)</script> and <img src=x onerror=boom()>'} />,
    );
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.querySelector('script, img')).toBeNull();
  });

  it('keeps a blank line inside a fenced code block', () => {
    const { container } = render(
      <MarkdownAnswer text={'```\nline one\n\nline two\n```\n\nAfter the fence.'} />,
    );
    expect(container.querySelector('pre code')?.textContent).toBe('line one\n\nline two');
    expect(container.querySelectorAll('pre')).toHaveLength(1);
    expect(container.textContent).toContain('After the fence.');
  });

  it('renders bold, inline code, lists and fenced code', () => {
    const { container } = render(
      <MarkdownAnswer
        text={'**Bold** and `code`\n\n- one\n- two\n\n1. first\n2) second\n\n```py\nx = 1 < 2\n```'}
      />,
    );
    expect(container.querySelector('strong')).toHaveTextContent('Bold');
    expect(container.querySelector('p code')).toHaveTextContent('code');
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelector('pre code')?.textContent).toBe('x = 1 < 2');
  });

  it('typesets $$ blocks and inline math with trust off and leaves plain text alone', () => {
    const { container } = render(
      <MarkdownAnswer text={'Plain paragraph\n\n$$\\int_0^1 x\\,dx$$\n\nEnergy $E=mc^2$ here'} />,
    );
    expect(typeset).toHaveBeenCalledTimes(2);
    const [root, options] = typeset.mock.calls[0] ?? [];
    expect(root).toBeInstanceOf(HTMLElement);
    expect((root as HTMLElement).textContent).toBe('$$\\int_0^1 x\\,dx$$');
    expect(options).toBe(KATEX_OPTIONS);
    expect(options).toMatchObject({
      trust: false,
      throwOnError: false,
      strict: 'ignore',
      maxSize: 10,
      maxExpand: 1000,
    });
    expect(KATEX_OPTIONS.delimiters).toEqual(
      expect.arrayContaining([
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
      ]),
    );
    expect(container.textContent).toContain('Plain paragraph');
  });

  it('writes math as text, never as parsed HTML', () => {
    const { container } = render(<MarkdownAnswer text="$$<img src=x onerror=boom()>$$" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x');
  });

  it('survives re-renders after KaTeX rewrote its DOM', () => {
    typeset.mockImplementation((root) => {
      const rendered = document.createElement('span');
      rendered.className = 'katex';
      rendered.textContent = 'RENDERED';
      root.replaceChildren(rendered);
    });
    const { container, rerender } = render(<MarkdownAnswer text="Inline $a$ text" />);
    expect(container.querySelector('.katex')).toHaveTextContent('RENDERED');
    rerender(<MarkdownAnswer text="Inline $a$ text" />);
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
    rerender(<MarkdownAnswer text="Inline $b$ text" />);
    expect(container.querySelectorAll('.katex')).toHaveLength(1);
    expect(typeset).toHaveBeenCalledTimes(2);
  });
});

describe('ensureKatex', () => {
  it('injects the vendored stylesheet and scripts, never a CDN', async () => {
    delete window.renderMathInElement;
    vi.resetModules();
    const { ensureKatex } = await import('./katex');
    void ensureKatex().catch(() => {});
    expect(document.head.querySelector('link[href="/static/vendor/katex/katex.min.css"]')).not.toBeNull();
    expect(document.head.querySelector('script[src="/static/vendor/katex/katex.min.js"]')).not.toBeNull();
  });
});

describe('sources and links', () => {
  it('builds hrefs and labels like the legacy renderer', () => {
    expect(bookHref({ book: 'dir x/a.pdf', page: 12 })).toBe('/book/dir%20x/a.pdf#p12');
    expect(bookHref({ book: 'n.md', line: 40 })).toBe('/book/n.md#L40');
    expect(bookHref({ book: 'n.md' })).toBe('/book/n.md');
    expect(sourceLabel({ book: 'dir/a.pdf', page: 3, section: 'Intro' })).toBe('a.pdf · p.3 · § Intro');
    expect(sourceLabel({ book: 'n.md', line: 40, line_end: 44 })).toBe('n.md · lines 40–44');
    expect(sourceLabel({ book: 'n.md', line: 40, line_end: 40 })).toBe('n.md · lines 40');
  });

  it('classifies SPA routes as internal', () => {
    expect(isInternalHref('/book/a.pdf#p1')).toBe(true);
    expect(isInternalHref('/ask?chat=1')).toBe(true);
    expect(isInternalHref('/static/vendor/x')).toBe(false);
    expect(isInternalHref('https://example.test/')).toBe(false);
  });

  it('links sources into the reader, with or without a router', () => {
    const sources = [{ book: 'a.pdf', page: 12 }, { book: 'n.md', line: 40 }];
    const { unmount } = render(
      <MemoryRouter>
        <SourceList sources={sources} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'a.pdf · p.12' })).toHaveAttribute('href', '/book/a.pdf#p12');
    unmount();
    render(<SourceList sources={sources} />);
    expect(screen.getByRole('link', { name: 'n.md · lines 40' })).toHaveAttribute('href', '/book/n.md#L40');
  });

  it('keeps the full label in a tooltip so CSS can truncate long filenames', () => {
    const book = `${'very-long-title-'.repeat(6)}.pdf`;
    render(<SourceList sources={[{ book, page: 3, section: 'Monte Carlo methods' }]} />);
    const label = sourceLabel({ book, page: 3, section: 'Monte Carlo methods' });
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('title', label);
  });
});

describe('ChatMessageView', () => {
  it('shows user text verbatim and parses assistant text as Markdown', () => {
    const { container } = render(
      <>
        <ChatMessageView message={{ role: 'user', content: '**not bold**' }} />
        <ChatMessageView
          message={{ role: 'assistant', content: '**bold**', sources: [{ book: 'a.pdf', page: 1 }] }}
        />
      </>,
    );
    expect(screen.getByText('**not bold**')).toBeInTheDocument();
    expect(container.querySelectorAll('strong')).toHaveLength(1);
    expect(screen.getByText('a.pdf · p.1')).toBeInTheDocument();
  });
});

describe('Rich Markdown & OpenUI Generative Blocks', () => {
  it('renders headings, blockquotes, pipe tables, and inline book citations', () => {
    const { container } = render(
      <MemoryRouter>
        <MarkdownAnswer
          text={[
            '## Section 3.2 Overview',
            '',
            '> Key theorem from the text.',
            '',
            'See attention.pdf#p12 and `notes.md#L40` for details.',
            '',
            '| Model | Complexity |',
            '| --- | --- |',
            '| Attention | O(n^2) |',
          ].join('\n')}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Section 3.2 Overview' })).toBeInTheDocument();
    expect(container.querySelector('blockquote')).toHaveTextContent('Key theorem from the text.');
    expect(container.querySelector('table')).toHaveTextContent('O(n^2)');
    expect(screen.getByRole('link', { name: 'attention.pdf#p12' })).toHaveAttribute(
      'href',
      '/book/attention.pdf#p12',
    );
    expect(screen.getByRole('link', { name: 'notes.md#L40' })).toHaveAttribute(
      'href',
      '/book/notes.md#L40',
    );
  });

  it('renders Socratic SkillMap and triggers interactive tutor commands', () => {
    const onPrompt = vi.fn();
    const skillMapBlock = [
      '```openui',
      JSON.stringify({
        component: 'SkillMap',
        topic: 'Scaled Dot-Product Attention',
        book: 'attention.pdf#p4',
        focus: 'Scaling factor',
        skills: [
          { name: 'Dot product similarity', level: 4 },
          { name: 'Scaling factor', level: 2, status: 'focus', note: 'Next up' },
        ],
      }),
      '```',
    ].join('\n');

    render(
      <MemoryRouter>
        <MarkdownAnswer text={skillMapBlock} onPrompt={onPrompt} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Socratic Skill Map · 60% Mastery/)).toBeInTheDocument();
    expect(screen.getByText('Scaled Dot-Product Attention')).toBeInTheDocument();
    expect(screen.getByText('4 · Independent')).toBeInTheDocument();
    expect(screen.getByText('2 · Follow along')).toBeInTheDocument();

    screen.getByRole('button', { name: 'Just tell me' }).click();
    expect(onPrompt).toHaveBeenCalledWith('just tell me');
  });

  it('renders ConceptCard, ComparisonTable, StepWalkthrough, BookList, and streaming placeholder', () => {
    const blocks = [
      '```openui',
      JSON.stringify({
        component: 'ConceptCard',
        title: 'Self-Attention',
        intuition: 'Tokens attend to relevant context.',
        formal: 'Softmax(QK^T / sqrt(d_k))V',
        takeaways: ['Parallelizable across sequence length'],
      }),
      '```',
      '',
      '```openui',
      '{"component": "SkillMap", "topic": "Partial stream',
    ].join('\n');

    render(
      <MemoryRouter>
        <MarkdownAnswer text={blocks} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Self-Attention')).toBeInTheDocument();
    expect(screen.getByText('Tokens attend to relevant context.')).toBeInTheDocument();
    expect(screen.getByText('Parallelizable across sequence length')).toBeInTheDocument();
    expect(screen.getByText(/Building SkillMap/)).toBeInTheDocument();
  });

  it('renders ConceptGraph interactive SVG, Chart bars, and auto-detects json fences with trailing commas', () => {
    const onPrompt = vi.fn();
    const blocks = [
      '```json',
      '{"component": "ConceptGraph", "title": "Attention Pipeline", "nodes": [' +
        '{"id": "qkv", "label": "QKV Projection", "group": "input", "detail": "Projects **tokens** into `Q, K, V`"},' +
        '{"id": "out", "label": "Context Output", "group": "output", "detail": "Weighted sum of values",}' +
        '], "edges": [{"from": "qkv", "to": "out", "label": "softmax"}],}',
      '```',
      '',
      '```openui',
      JSON.stringify({
        component: 'Chart',
        title: 'Latency Benchmark',
        unit: 'ms',
        items: [
          { label: 'Mercury 3', value: 120, displayValue: '120 ms', note: 'Diffusion LLM' },
          { label: 'Standard Autoregressive', value: 480, displayValue: '480 ms' },
        ],
        caption: 'End-to-end tool synthesis latency',
      }),
      '```',
    ].join('\n');

    render(
      <MemoryRouter>
        <MarkdownAnswer text={blocks} onPrompt={onPrompt} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('img', { name: 'Attention Pipeline' })).toBeInTheDocument();
    expect(screen.getByText(/Projects/)).toBeInTheDocument();
    expect(screen.getByText('tokens').tagName).toBe('STRONG');

    // Click second node in the ConceptGraph SVG
    fireEvent.click(screen.getByRole('button', { name: 'Select concept node Context Output' }));
    expect(screen.getByText('Weighted sum of values')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Explore Context Output →' }).click();
    expect(onPrompt).toHaveBeenCalledWith(
      'Explain Context Output in the context of Attention Pipeline',
    );

    // Chart assertions
    expect(screen.getByText('Latency Benchmark')).toBeInTheDocument();
    expect(screen.getByText('120 ms')).toBeInTheDocument();
    expect(screen.getByText('Diffusion LLM')).toBeInTheDocument();
  });

  it('renders thought process disclosure when thought_steps are provided', () => {
    render(
      <MemoryRouter>
        <ChatMessageView
          message={{
            role: 'assistant',
            content: 'Here is the answer.',
            thought_steps: [
              'Searching library for attention',
              'Reading section 3.1 in transformers.pdf',
              'Synthesizing explanation',
            ],
            thought: 'We should highlight key formulas.',
          }}
          variant="thread"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Research & reasoning process \(3 steps\)/)).toBeInTheDocument();
    expect(screen.getByText('Searching library for attention')).toBeInTheDocument();
    expect(screen.getByText('Reading section 3.1 in transformers.pdf')).toBeInTheDocument();
    expect(screen.getByText('We should highlight key formulas.')).toBeInTheDocument();
  });
});
