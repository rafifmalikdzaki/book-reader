import { Fragment, useMemo } from 'react';

import styles from './ChatRender.module.css';
import { MATH_HINT, MathText } from './MathText';
import { OpenUIBlockView } from './OpenUIBlockView';
import { SmartLink } from './SmartLink';
import { parseMarkdown, type Block, type Inline } from './markdown';

function Text({ value }: { value: string }) {
  return MATH_HINT.test(value) ? <MathText text={value} /> : <>{value}</>;
}

function InlineView({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case 'text':
        return <Text key={index} value={node.value} />;
      case 'strong':
        return (
          <strong key={index}>
            <InlineView nodes={node.children} />
          </strong>
        );
      case 'code':
        return <code key={index}>{node.value}</code>;
      case 'link':
        return (
          <SmartLink key={index} href={node.href}>
            <Text value={node.label} />
          </SmartLink>
        );
    }
  });
}

function BlockView({ block, onPrompt }: { block: Block; onPrompt?: (prompt: string) => void }) {
  switch (block.kind) {
    case 'openui':
      return (
        <OpenUIBlockView
          code={block.code}
          closed={block.closed}
          format={block.format}
          onPrompt={onPrompt}
        />
      );
    case 'fence':
      return (
        <pre>
          <code>{block.code}</code>
        </pre>
      );
    case 'heading': {
      const Tag = (`h${Math.min(6, block.level + 1)}` as 'h2' | 'h3' | 'h4' | 'h5');
      return (
        <Tag className={styles.mdHeading}>
          <InlineView nodes={block.children} />
        </Tag>
      );
    }
    case 'blockquote':
      return (
        <blockquote className={styles.mdQuote}>
          {block.lines.map((line, index) => (
            <Fragment key={index}>
              {index > 0 ? <br /> : null}
              <InlineView nodes={line} />
            </Fragment>
          ))}
        </blockquote>
      );
    case 'table':
      return (
        <div className={styles.tableWrap}>
          <table className={styles.uiTable}>
            <thead>
              <tr>
                {block.headers.map((cell, index) => (
                  <th key={index} scope="col">
                    <InlineView nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx}>
                      <InlineView nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr className={styles.mdRule} />;
    case 'math':
      return (
        <p>
          <MathText text={block.text} />
        </p>
      );
    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <InlineView nodes={item} />
        </li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case 'paragraph':
      return (
        <p>
          {block.lines.map((line, index) => (
            <Fragment key={index}>
              {index > 0 ? <br /> : null}
              <InlineView nodes={line} />
            </Fragment>
          ))}
        </p>
      );
  }
}

/**
 * Assistant answer as React elements (replaces ChatRender.renderAnswer). Supports bold,
 * `code`, safe links, inline book citations, headings, blockquotes, pipe tables,
 * bullet/numbered lists, fenced code, OpenUI generative blocks, and LaTeX; no HTML is parsed.
 */
export function MarkdownAnswer({
  text,
  onPrompt,
}: {
  text: string;
  onPrompt?: (prompt: string) => void;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={styles.rich}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} onPrompt={onPrompt} />
      ))}
    </div>
  );
}
