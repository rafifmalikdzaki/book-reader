import { describe, expect, it } from 'vitest';

import type { ConceptGraphBlock } from '../openui';
import { computeGraphLayout } from './graphLayout';

const graph = (
  nodes: string[],
  edges: [string, string][],
): ConceptGraphBlock => ({
  component: 'ConceptGraph',
  title: 'G',
  nodes: nodes.map((id) => ({ id, label: id })),
  edges: edges.map(([from, to]) => ({ from, to })),
});

describe('computeGraphLayout', () => {
  it('places each node one column right of its deepest predecessor', () => {
    const { positioned } = computeGraphLayout(
      graph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['a', 'c']]),
    );
    expect(['a', 'b', 'c'].map((id) => positioned.get(id)!.col)).toEqual([0, 1, 2]);
  });

  it('keeps every node when the graph has a cycle, self-loop or dangling edge', () => {
    const { positioned, width, height } = computeGraphLayout(
      graph(['a', 'b'], [['a', 'b'], ['b', 'a'], ['a', 'a'], ['a', 'ghost']]),
    );
    expect([...positioned.keys()].sort()).toEqual(['a', 'b']);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('puts independent nodes in the same column on different rows', () => {
    const { positioned } = computeGraphLayout(graph(['a', 'b'], []));
    expect(positioned.get('a')!.col).toBe(positioned.get('b')!.col);
    expect(positioned.get('a')!.row).not.toBe(positioned.get('b')!.row);
  });
});
