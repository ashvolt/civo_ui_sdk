import type { Document, Node } from "../workloads/generator.ts";
import type { Payload } from "./corpus.ts";

/**
 * Where a payload goes (T-441, contracts/attacks.md "Placement"): every string
 * prop of every component, text, URL and enumerated alike, one at a time. A
 * case's document holds one node per slot, each a benign component with the
 * payload in exactly that slot, so a node refused for one bad prop never hides
 * what another prop would have done.
 */

/** Each component with every string prop set to something valid. */
export const BENIGN: Readonly<Record<string, Omit<Node, "key">>> = {
  Stack: { type: "Stack", props: { gap: "md", direction: "column" }, children: [{ type: "Text", props: { text: "in a stack", tone: "default" } }] },
  Grid: { type: "Grid", props: { columns: 2 }, children: [{ type: "Text", props: { text: "in a grid", tone: "default" } }] },
  Card: { type: "Card", props: { title: "Card", subtitle: "Subtitle" }, children: [{ type: "Text", props: { text: "in a card", tone: "default" } }] },
  Heading: { type: "Heading", props: { text: "Heading", level: 2 } },
  Text: { type: "Text", props: { text: "Text", tone: "muted" } },
  Metric: { type: "Metric", props: { label: "Label", value: "42", trend: "up", caption: "Caption" } },
  List: { type: "List", props: { items: ["one", "two"], ordered: false } },
  Table: { type: "Table", props: { caption: "Caption", columns: ["A", "B"], rows: [["1", "2"]] } },
  Callout: { type: "Callout", props: { tone: "info", title: "Title", body: "Body" } },
  Badge: { type: "Badge", props: { text: "Badge", tone: "info" } },
  Link: { type: "Link", props: { label: "Link", href: "https://example.com/" } },
  Chart: { type: "Chart", props: { kind: "bar", title: "Chart", unit: "kg", labels: ["a", "b"], series: [{ name: "s", values: [1, 2] }] } },
  Heatmap: { type: "Heatmap", props: { title: "Heatmap", unit: "kg", rows: ["r"], columns: ["c"], values: [[1]] } },
  Scatter: { type: "Scatter", props: { title: "Scatter", xLabel: "x", yLabel: "y", series: [{ name: "s", points: [[1, 2]] }] } },
  SparklineGrid: { type: "SparklineGrid", props: { title: "Sparks", items: [{ label: "spark", values: [1, 3, 2] }] } },
  AnimatedCounter: { type: "AnimatedCounter", props: { label: "Counter", value: 7, unit: "kg", tone: "info" } },
};

/** Paths to every string in a value, as `a.0.b`. */
export function stringPaths(value: unknown, at: string[] = []): string[][] {
  if (typeof value === "string") return [at];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringPaths(v, [...at, String(i)]));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => stringPaths(v, [...at, k]));
  return [];
}

function setPath(value: unknown, path: string[], to: string): unknown {
  if (path.length === 0) return to;
  const [head, ...rest] = path as [string, ...string[]];
  if (Array.isArray(value)) return value.map((v, i) => (String(i) === head ? setPath(v, rest, to) : v));
  const obj = value as Record<string, unknown>;
  return { ...obj, [head]: setPath(obj[head], rest, to) };
}

export interface Slot {
  /** `Card.title`, `Table.rows.0.1`. */
  id: string;
  type: string;
  path: string[];
}

/** Every string prop of the given components. */
export function slots(types: readonly string[] = Object.keys(BENIGN)): Slot[] {
  return types.flatMap((type) => stringPaths(BENIGN[type]!.props).map((path) => ({ id: [type, ...path].join("."), type, path })));
}

const keyOf = (s: string) => s.replace(/[^A-Za-z0-9]/g, "_");

/** A case's id for one slot: what the canary and the request URL carry. */
export const caseId = (payload: Payload, slot: Slot) => `${payload.id}~${slot.id}`;

/** One document per payload: a node per slot, each with the payload in that slot only. */
export function placedDocument(payload: Payload | undefined, list: readonly Slot[] = slots()): Document {
  return {
    root: {
      type: "Stack",
      key: "attack",
      props: { gap: "sm", direction: "column" },
      children: list.map((slot, i) => {
        const benign = BENIGN[slot.type]!;
        const props = payload ? (setPath(benign.props, slot.path, payload.make(caseId(payload, slot))) as Record<string, unknown>) : benign.props;
        return {
          ...structuredClone(benign),
          key: `s${i}_${keyOf(slot.id)}`,
          props,
          ...(benign.children ? { children: benign.children.map((c, j) => ({ ...c, key: `s${i}_c${j}` })) } : {}),
        };
      }),
    },
  };
}
