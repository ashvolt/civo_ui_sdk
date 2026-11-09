/**
 * The shape of a generative UI document, and the walk that measures it.
 *
 * Moved here from `relax-ui-core` (which re-exports both) because every
 * renderer needs them and none of them needs Zod.
 */

export interface UINode {
  type: string;
  props: Record<string, unknown>;
  children?: UINode[];
  /** Stable identity for reconciliation across streaming frames. */
  key?: string;
}

export interface TreeBudget {
  nodes: number;
  depth: number;
}

/**
 * Counts nodes and depth, iteratively.
 *
 * Recursion here would mean a model could crash the server with a deeply nested
 * document before the depth limit was ever checked — the stack overflow happens
 * during measurement. An explicit stack makes the guard actually a guard.
 */
export function measureTree(root: UINode | undefined): TreeBudget {
  if (!root) return { nodes: 0, depth: 0 };
  let nodes = 0;
  let depth = 0;
  const stack: { node: UINode; level: number }[] = [{ node: root, level: 1 }];

  while (stack.length > 0) {
    const entry = stack.pop() as { node: UINode; level: number };
    nodes++;
    if (entry.level > depth) depth = entry.level;
    // Hard stop: a pathological document must not be walked to completion.
    if (nodes > 100_000) break;
    const children = entry.node.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child && typeof child === "object") stack.push({ node: child, level: entry.level + 1 });
      }
    }
  }

  return { nodes, depth };
}
