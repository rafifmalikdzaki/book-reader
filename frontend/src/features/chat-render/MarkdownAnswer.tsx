import { Fragment, useMemo } from 'react';

import styles from './ChatRender.module.css';
import { MATH_HINT, MathText } from './MathText';
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

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'fence':
      return (
        <pre>
          <code>{block.code}</code>
        </pre>
      );
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
 * `code`, safe links, bullet/numbered lists, fenced code and LaTeX; no HTML is parsed.
 */
export function MarkdownAnswer({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={styles.rich}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}
