import type { Document, Node } from "../workloads/generator.ts";
import { BENIGN, placedDocument } from "./place.ts";

/**
 * Injection tricks (T-443, contracts/attacks.md "Injection tricks", research
 * R9): documents that try something other than script. Each is run as an
 * injection case is, and judged by the same evidence: a prototype or global
 * that changed, an attribute the template does not set, a request, an element
 * drawn outside its box, an element that is not the template's.
 *
 * Values shaped as CSS or selectors, and the policy-bypass elements, are in
 * the corpus (`css`, `policy-bypass`), placed in every prop.
 */

export interface Trick {
  id: string;
  /** What the case tries. */
  technique: "proto-key" | "identity-attribute" | "overlay";
  document: Document;
}

const stack = (children: Node[]): Document => ({ root: { type: "Stack", key: "trick", props: { gap: "sm", direction: "column" }, children } });

const each = (make: (type: string, i: number) => Node): Node[] => Object.keys(BENIGN).map((type, i) => make(type, i));

const withChildren = (type: string, i: number, props: Record<string, unknown>): Node => {
  const b = BENIGN[type]!;
  return { ...structuredClone(b), key: `t${i}`, props, ...(b.children ? { children: b.children.map((c, j) => ({ ...c, key: `t${i}c${j}` })) } : {}) };
};

/**
 * Prototype keys as own properties of props, as `JSON.parse` makes them from
 * model output: `__proto__`, `constructor.prototype`, `prototype`.
 */
function protoKeys(): Document {
  return stack(
    each((type, i) => {
      const extra = JSON.parse(
        '{"__proto__":{"polluted":"pwn","relaxPolluted":"pwn"},"constructor":{"prototype":{"polluted":"pwn"}},"prototype":{"polluted":"pwn"}}',
      ) as Record<string, unknown>;
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(BENIGN[type]!.props)) props[k] = v;
      for (const k of Object.keys(extra)) Object.defineProperty(props, k, { value: extra[k], enumerable: true, writable: true, configurable: true });
      return withChildren(type, i, props);
    }),
  );
}

/** Props named like the attributes that change identity, styling or slotting. */
function identity(): Document {
  const names = ["style", "class", "className", "slot", "part", "id", "is", "hidden", "tabindex", "exportparts", "popover", "inert"];
  return stack(
    each((type, i) => {
      const props: Record<string, unknown> = { ...BENIGN[type]!.props };
      for (const n of names) props[n] = n === "style" ? `position:fixed;inset:0;z-index:2147483647;background:red;--relaxident:1` : `relaxident-${type}-${n}`;
      return withChildren(type, i, props);
    }),
  );
}

/**
 * Attempts to cover the page without styles: one unbroken word far wider than
 * any screen, thousands of lines, in every string prop.
 */
function overlay(): Document[] {
  const word = "W".repeat(5_000);
  const lines = Array.from({ length: 2_000 }, () => "line").join("\n");
  const as = (id: string, text: string) => ({ id, technique: "event-handler" as const, make: () => text });
  return [placedDocument(as("overlay.word", word)), placedDocument(as("overlay.lines", lines))];
}

export function tricks(): Trick[] {
  const [word, lines] = overlay();
  return [
    { id: "proto-key.props", technique: "proto-key", document: protoKeys() },
    { id: "identity.props", technique: "identity-attribute", document: identity() },
    { id: "overlay.unbroken-word", technique: "overlay", document: word! },
    { id: "overlay.many-lines", technique: "overlay", document: lines! },
  ];
}
