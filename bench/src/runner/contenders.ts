import { diffJson, type JsonValue } from "relax-ui-protocol";
import { benchContract } from "../workloads/contract.ts";
import type { Dimension, Document, Node } from "../workloads/generator.ts";

/**
 * Each contender's own wire format for the same logical frames (plan D3,
 * research R3). An encoder returns one chunk per logical frame, or says why
 * the contender's format cannot express the workload (T-436).
 */

export type Encoded = { chunks: string[] } | { notExpressible: string };

/** Ladders whose frames grow arrays inside one node rather than add nodes. */
const ARRAY_GROWTH: ReadonlySet<Dimension> = new Set(["table-cells", "chart-points", "heatmap-cells", "scatter-points", "sparklines"]);
/** Ladders whose frames change what is already on the page. */
const EDITS: ReadonlySet<Dimension> = new Set(["text-churn", "counters"]);

// --- json-render: JSONL lines of RFC 6902 patches to a flat spec ---------------

/** json-render's spec: a flat map of elements by key, children as keys. */
export interface FlatSpec {
  root: string;
  elements: Record<string, { type: string; props: Record<string, unknown>; children?: string[] }>;
}

export function toFlatSpec(doc: Document): FlatSpec {
  const elements: FlatSpec["elements"] = {};
  const visit = (n: Node) => {
    elements[n.key!] = { type: n.type, props: n.props, ...(n.children ? { children: n.children.map((c) => c.key!) } : {}) };
    n.children?.forEach(visit);
  };
  visit(doc.root);
  return { root: doc.root.key!, elements };
}

/**
 * One chunk per frame: the patch lines that turn the previous frame's spec
 * into this one's, as `createSpecStreamCompiler` reads them.
 */
export function jsonRenderJSONL(frames: readonly Document[]): Encoded {
  // json-render starts every stream from an empty spec, and writes elements
  // one line each (`/elements/<key>`), as its model prompt asks.
  let previous: FlatSpec = { root: "", elements: {} };
  const chunks = frames.map((frame) => {
    const spec = toFlatSpec(frame);
    const ops = diffJson(previous as unknown as JsonValue, spec as unknown as JsonValue);
    previous = spec;
    return ops.map((op) => `${JSON.stringify(op)}\n`).join("");
  });
  return { chunks };
}

// --- OpenUI Lang: a program of statements, written top-down -------------------

/** Positional arguments, in the order the bench contract declares props; then children. */
export function propOrder(type: string): string[] {
  const shape = (benchContract.spec(type)?.props as unknown as { shape?: Record<string, unknown> })?.shape ?? {};
  return [...Object.keys(shape), "children"];
}

const literal = (v: unknown): string => (v === undefined ? "null" : JSON.stringify(v));

function statement(id: string, node: Node, childIds: readonly string[] | undefined): string {
  const order = propOrder(node.type);
  const args = order.map((name) => (name === "children" ? (childIds ? `[${childIds.join(", ")}]` : "null") : literal(node.props[name])));
  while (args.length && args.at(-1) === "null") args.pop();
  return `${id} = ${node.type}(${args.join(", ")})\n`;
}

/** Statement names: the root is `root`; every other node its key. */
const idOf = (n: Node, root: Node) => (n === root || n.key === root.key ? "root" : `n_${n.key}`);

function preorder(root: Node): Node[] {
  const out: Node[] = [];
  const visit = (n: Node) => {
    out.push(n);
    n.children?.forEach(visit);
  };
  visit(root);
  return out;
}

/**
 * The program as a model writes it: the root first, each statement naming
 * children not yet written. Nodes arrive in document order, so frame k ends
 * after the statement of its last node. Arrays that grow inside one node
 * arrive as that statement's text, a slice per frame. Edits are statements
 * written again: in OpenUI Lang the later one wins.
 */
export function openuiLang(frames: readonly Document[], dimension: Dimension): Encoded {
  const final = frames.at(-1)!;
  const childIds = new Map<string, string[]>();
  for (const n of preorder(final.root)) if (n.children) childIds.set(n.key!, n.children.map((c) => idOf(c, final.root)));
  const write = (n: Node) => statement(idOf(n, final.root), n, n.children ? childIds.get(n.key!) : undefined);

  if (ARRAY_GROWTH.has(dimension)) {
    const text = preorder(final.root).map(write).join("");
    return { chunks: split(text, frames.length) };
  }
  const written = new Map<string, string>();
  const chunks = frames.map((frame) => {
    let out = "";
    for (const n of preorder(frame.root)) {
      const props = JSON.stringify(n.props);
      if (written.get(n.key!) === props) continue;
      // A new node, or one whose props changed: an edit.
      if (written.has(n.key!) && !EDITS.has(dimension)) continue;
      written.set(n.key!, props);
      out += write(n);
    }
    return out;
  });
  return { chunks };
}

function split(text: string, parts: number): string[] {
  const size = Math.ceil(text.length / parts);
  return Array.from({ length: parts }, (_, i) => text.slice(i * size, (i + 1) * size));
}

// --- AI SDK: one JSON text, read as partial JSON ------------------------------

/**
 * The final document as JSON text, cut so that frame k's text ends where frame
 * k's content does. A partial-JSON stream only appends, so a workload that
 * edits what is already shown cannot be written in it.
 */
export function aiSdkJSON(frames: readonly Document[], dimension: Dimension): Encoded {
  if (EDITS.has(dimension)) {
    return { notExpressible: "a partial-JSON stream only appends; this workload edits content already shown" };
  }
  const text = JSON.stringify(frames.at(-1));
  if (ARRAY_GROWTH.has(dimension)) return { chunks: split(text, frames.length) };
  const ends = frames.map((f) => JSON.stringify(f).replace(/[\]}]+$/, "").length);
  if (frames.some((f, i) => !text.startsWith(JSON.stringify(f).slice(0, ends[i])))) {
    return { chunks: split(text, frames.length) };
  }
  let at = 0;
  return {
    chunks: ends.map((end, i) => {
      const chunk = text.slice(at, i === ends.length - 1 ? text.length : end);
      at = i === ends.length - 1 ? text.length : end;
      return chunk;
    }),
  };
}
