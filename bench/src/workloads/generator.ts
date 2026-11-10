import { seeded, type Random } from "./random.ts";

/**
 * Seeded documents and frame sequences (FR-401, FR-403, data model §1–2).
 *
 * A step's frames are the document growing node by node, in document order:
 * frame k holds the first ⌈k·N/K⌉ nodes, so every renderer sees content arrive
 * as a model would write it. The static ladder delivers the whole document in
 * one frame, as a static JSON source does. The text-churn workload builds the
 * document, then changes text in place.
 */

export interface Node {
  type: string;
  key?: string;
  props: Record<string, unknown>;
  children?: Node[];
}

export interface Document {
  root: Node;
}

export type Dimension =
  | "nodes"
  | "static-nodes"
  | "depth"
  | "table-cells"
  | "chart-points"
  | "frame-rate"
  | "text-churn"
  | "tone-density";

export interface StepPlan {
  dimension: Dimension;
  size: number;
  seed: number;
  /** Frames in the sequence. */
  frames: number;
  /** Frames per second. */
  rate: number;
}

const WORDS = ["spend", "region", "growth", "cloud", "provider", "quarter", "budget", "forecast", "usage", "capacity", "latency", "cost"];
const TONES = ["info", "success", "warning", "danger"] as const;
const BADGE_TONES = ["neutral", "info", "success", "warning", "danger"] as const;

const words = (r: Random, n: number) => Array.from({ length: n }, () => r.pick(WORDS)).join(" ");
const label = (r: Random) => words(r, 2).replace(/^./, (c) => c.toUpperCase());

/** A leaf component, varied but always valid against the contract. */
function leaf(r: Random, key: string, toned: boolean): Node {
  switch (r.int(0, 6)) {
    case 0:
      return { type: "Heading", key, props: { text: label(r), level: r.int(2, 4) } };
    case 1:
      return { type: "Metric", key, props: { label: label(r), value: `${r.int(1, 999)}${r.pick(["%", "k", "m"])}`, trend: r.pick(["up", "down", "flat"]) } };
    case 2:
      return { type: "Badge", key, props: { text: r.pick(WORDS), ...(toned ? { tone: r.pick(BADGE_TONES) } : {}) } };
    case 3:
      return { type: "Callout", key, props: { title: label(r), body: words(r, 8), ...(toned ? { tone: r.pick(TONES) } : {}) } };
    case 4:
      return { type: "Link", key, props: { label: label(r), href: `https://example.com/${r.pick(WORDS)}` } };
    case 5:
      return { type: "List", key, props: { items: [label(r), label(r), label(r)] } };
    default:
      return { type: "Text", key, props: { text: words(r, 10), ...(toned ? { tone: r.pick(["default", "muted"]) } : {}) } };
  }
}

/**
 * Exactly `count` nodes: a root Stack of Grids and Cards (depth ≤ 4), each
 * holding up to ten leaves. `tonedShare` of leaves carry an explicit tone.
 */
export function mixedDocument(count: number, seed: number, tonedShare = 0.5): Document {
  const r = seeded(seed);
  let made = 1;
  let id = 0;
  const groups: Node[] = [];
  while (made < count) {
    const group: Node =
      r.next() < 0.5
        ? { type: "Grid", key: `g${id++}`, props: { columns: r.int(2, 4) }, children: [] }
        : { type: "Card", key: `c${id++}`, props: { title: label(r) }, children: [] };
    made++;
    groups.push(group);
    const leaves = Math.min(10, count - made);
    for (let i = 0; i < leaves; i++) {
      group.children!.push(leaf(r, `n${id++}`, r.next() < tonedShare));
      made++;
    }
  }
  return { root: { type: "Stack", key: "root", props: { gap: "md" }, children: groups } };
}

/** A chain of nested Stacks `depth` deep, padded with leaves to 200 nodes. */
export function deepDocument(depth: number, seed: number, total = 200): Document {
  const r = seeded(seed);
  const root: Node = { type: "Stack", key: "d0", props: {}, children: [] };
  let at = root;
  for (let d = 1; d < depth; d++) {
    const next: Node = { type: d % 2 ? "Card" : "Stack", key: `d${d}`, props: d % 2 ? { title: `Level ${d}` } : {}, children: [] };
    at.children!.push(next);
    at = next;
  }
  let made = depth;
  let i = 0;
  while (made < total) {
    at.children!.push(leaf(r, `l${i++}`, false));
    made++;
  }
  return { root };
}

export function tableDocument(cells: number, seed: number, columns = 10): Document {
  const r = seeded(seed);
  const rows = Math.max(1, Math.round(cells / columns));
  return {
    root: {
      type: "Stack",
      key: "root",
      props: {},
      children: [
        { type: "Heading", key: "h", props: { text: `Table of ${rows * columns} cells`, level: 2 } },
        {
          type: "Table",
          key: "t",
          props: {
            caption: "Generated",
            columns: Array.from({ length: columns }, (_, c) => `Column ${c + 1}`),
            rows: Array.from({ length: rows }, () => Array.from({ length: columns }, () => `${r.pick(WORDS)} ${r.int(1, 9999)}`)),
          },
        },
      ],
    },
  };
}

export function chartDocument(points: number, seed: number, series = 4): Document {
  const r = seeded(seed);
  const labels = Math.max(1, Math.round(points / series));
  return {
    root: {
      type: "Stack",
      key: "root",
      props: {},
      children: [
        { type: "Chart", key: "line", props: { kind: "line", title: "Line", labels: Array.from({ length: labels }, (_, i) => `P${i}`), series: Array.from({ length: series }, (_, s) => ({ name: `S${s + 1}`, values: Array.from({ length: labels }, () => r.int(-50, 500)) })) } },
        { type: "Chart", key: "bar", props: { kind: "bar", title: "Bar", labels: Array.from({ length: labels }, (_, i) => `P${i}`), series: Array.from({ length: series }, (_, s) => ({ name: `S${s + 1}`, values: Array.from({ length: labels }, () => r.int(0, 500)) })) } },
      ],
    },
  };
}

/** The complete document for a step. */
export function documentFor(step: Pick<StepPlan, "dimension" | "size" | "seed">): Document {
  switch (step.dimension) {
    case "nodes":
    case "static-nodes":
      return mixedDocument(step.size, step.seed);
    case "depth":
      return deepDocument(step.size, step.seed);
    case "table-cells":
      return tableDocument(step.size, step.seed);
    case "chart-points":
      return chartDocument(step.size, step.seed);
    case "frame-rate":
      return mixedDocument(500, step.seed);
    case "text-churn":
      return mixedDocument(500, step.seed);
    case "tone-density":
      return mixedDocument(1000, step.seed, step.size / 100);
  }
}

/**
 * One of each of the twelve components: what the harness renders and discards
 * before a measured run, and what the cold-start measurement renders in a
 * fresh page.
 */
export function warmupDocument(): Document {
  return {
    root: {
      type: "Stack",
      key: "w",
      props: {},
      children: [
        { type: "Heading", key: "h", props: { text: "Warm-up", level: 2 } },
        { type: "Text", key: "t", props: { text: "Every component once." } },
        { type: "Grid", key: "g", props: { columns: 2 }, children: [{ type: "Metric", key: "m", props: { label: "Metric", value: "1", trend: "up" } }] },
        { type: "Card", key: "c", props: { title: "Card" }, children: [{ type: "Badge", key: "b", props: { text: "badge", tone: "info" } }] },
        { type: "List", key: "l", props: { items: ["one", "two"] } },
        { type: "Table", key: "tb", props: { columns: ["A", "B"], rows: [["1", "2"]] } },
        { type: "Callout", key: "co", props: { title: "Callout", body: "Body", tone: "warning" } },
        { type: "Link", key: "a", props: { label: "Link", href: "https://example.com/" } },
        { type: "Chart", key: "ch", props: { kind: "bar", title: "Chart", labels: ["a", "b"], series: [{ name: "s", values: [1, 2] }] } },
      ],
    },
  };
}

export function countNodes(node: Node | undefined): number {
  if (!node) return 0;
  let n = 0;
  const stack = [node];
  while (stack.length) {
    const x = stack.pop()!;
    n++;
    for (const c of x.children ?? []) stack.push(c);
  }
  return n;
}

export function depthOf(node: Node): number {
  let max = 0;
  const stack: [Node, number][] = [[node, 1]];
  while (stack.length) {
    const [x, d] = stack.pop()!;
    max = Math.max(max, d);
    for (const c of x.children ?? []) stack.push([c, d + 1]);
  }
  return max;
}

/** The first `n` nodes of `doc` in document order: a prefix of the tree. */
export function prefix(doc: Document, n: number): Document {
  let left = n;
  const copy = (node: Node): Node | undefined => {
    if (left <= 0) return undefined;
    left--;
    const out: Node = { ...node };
    if (node.children) {
      const kids: Node[] = [];
      for (const c of node.children) {
        const k = copy(c);
        if (!k) break;
        kids.push(k);
      }
      out.children = kids;
    }
    return out;
  };
  return { root: copy(doc.root)! };
}

/**
 * A large leaf (a Table, a Chart) grows by rows or points rather than by node,
 * so a one-node increment would deliver it in a single frame. Grow its arrays
 * proportionally instead.
 */
function partialLeaf(node: Node, share: number): Node {
  const props = { ...node.props };
  if (node.type === "Table") {
    const rows = props.rows as unknown[];
    props.rows = rows.slice(0, Math.max(1, Math.ceil(rows.length * share)));
  } else if (node.type === "Chart") {
    const labels = props.labels as string[];
    const n = Math.max(1, Math.ceil(labels.length * share));
    props.labels = labels.slice(0, n);
    props.series = (props.series as { name: string; values: number[] }[]).map((s) => ({ ...s, values: s.values.slice(0, n) }));
  }
  return { ...node, props };
}

/**
 * The frame sequence for a step (data model F1, F2). Nodes arrive in document
 * order; a document of few large leaves grows their arrays instead; the
 * text-churn workload rewrites `size`% of text props per frame.
 */
export function framesFor(step: StepPlan): Document[] {
  const doc = documentFor(step);
  const total = countNodes(doc.root);
  const k = step.frames;
  if (step.dimension === "static-nodes") return [doc];
  if (step.dimension === "text-churn") {
    // Build the document over the first half, as any stream would; churn its
    // text over the second half. Churn is what this ladder measures, not the
    // first render.
    const build = Math.floor(k / 2);
    const r = seeded(step.seed + 1);
    const out: Document[] = Array.from({ length: build }, (_, f) => prefix(doc, Math.ceil(((f + 1) * total) / build)));
    let current = doc;
    for (let f = build; f < k; f++) {
      current = churn(current, step.size / 100, r, f);
      out.push(current);
    }
    return out;
  }
  if (step.dimension === "table-cells" || step.dimension === "chart-points") {
    return Array.from({ length: k }, (_, f) => {
      const share = (f + 1) / k;
      const root = doc.root;
      return { root: { ...root, children: root.children!.map((c) => partialLeaf(c, share)) } };
    });
  }
  return Array.from({ length: k }, (_, f) => prefix(doc, Math.ceil(((f + 1) * total) / k)));
}

/** Rewrites the text of `share` of text-bearing nodes; untouched subtrees keep their identity. */
function churn(doc: Document, share: number, r: Random, frame: number): Document {
  const visit = (node: Node): Node => {
    let changed = node;
    if (typeof node.props.text === "string" && r.next() < share) {
      // Within each component's own limit: a Badge holds one or two words.
      const text = node.type === "Badge" ? `${r.pick(WORDS)} ${frame}` : `${words(r, 6)} ${frame}`;
      changed = { ...node, props: { ...node.props, text } };
    }
    if (node.children) {
      const kids = node.children.map(visit);
      if (kids.some((k, i) => k !== node.children![i])) changed = { ...changed, children: kids };
    }
    return changed;
  };
  return { root: visit(doc.root) };
}
