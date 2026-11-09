import {
  type ConceptGraphBlock,
  type GraphNode,
} from '../legacyJson';

export interface PositionedNode {
  node: GraphNode;
  col: number;
  row: number;
  x: number;
  y: number;
}

export function computeGraphLayout(spec: ConceptGraphBlock): {
  positioned: Map<string, PositionedNode>;
  width: number;
  height: number;
} {
  const nodeMap = new Map<string, GraphNode>();
  for (const n of spec.nodes) nodeMap.set(n.id, n);

  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of spec.nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of spec.edges) {
    if (nodeMap.has(e.from) && nodeMap.has(e.to) && e.from !== e.to) {
      adj.get(e.from)?.push(e.to);
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }
  }

  const layerOf = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      layerOf.set(id, 0);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currLayer = layerOf.get(curr) ?? 0;
    for (const next of adj.get(curr) ?? []) {
      const nextLayer = Math.max(layerOf.get(next) ?? 0, currLayer + 1);
      if (nextLayer <= 5) {
        layerOf.set(next, nextLayer);
      }
      const nextDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, nextDeg);
      if (nextDeg === 0) queue.push(next);
    }
  }

  // Fallback for cyclic or disconnected nodes
  spec.nodes.forEach((n, idx) => {
    if (!layerOf.has(n.id)) {
      layerOf.set(n.id, idx % 3);
    }
  });

  const columns = new Map<number, GraphNode[]>();
  for (const n of spec.nodes) {
    const col = layerOf.get(n.id) ?? 0;
    const list = columns.get(col) ?? [];
    list.push(n);
    columns.set(col, list);
  }

  const sortedCols = Array.from(columns.keys()).sort((a, b) => a - b);
  const maxRows = Math.max(1, ...Array.from(columns.values()).map((list) => list.length));
  const nodeW = 164;
  const nodeH = 54;
  const colGap = 68;
  const rowGap = 24;
  const padX = 20;
  const padY = 20;

  const width = Math.max(420, padX * 2 + sortedCols.length * nodeW + Math.max(0, sortedCols.length - 1) * colGap);
  const height = Math.max(120, padY * 2 + maxRows * nodeH + Math.max(0, maxRows - 1) * rowGap);

  const positioned = new Map<string, PositionedNode>();
  sortedCols.forEach((colKey, colIdx) => {
    const nodesInCol = columns.get(colKey) ?? [];
    const colHeight = nodesInCol.length * nodeH + Math.max(0, nodesInCol.length - 1) * rowGap;
    const startY = Math.max(padY, Math.round((height - colHeight) / 2));
    nodesInCol.forEach((node, rowIdx) => {
      const x = padX + colIdx * (nodeW + colGap);
      const y = startY + rowIdx * (nodeH + rowGap);
      positioned.set(node.id, { node, col: colIdx, row: rowIdx, x, y });
    });
  });

  return { positioned, width, height };
}
