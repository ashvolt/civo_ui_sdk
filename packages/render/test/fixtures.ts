import { applyPatch, diffJson, parsePartialJson, type JsonValue, type UINode } from "relax-ui-core";

/**
 * Three realistic documents, and the frames a browser would see while each one
 * streams in: every prefix of the model's JSON text, parsed leniently, turned
 * into patches and applied with structural sharing — exactly what the server
 * and `UIStreamAccumulator` do between them.
 */

const n = (type: string, props: Record<string, unknown>, children?: UINode[], key?: string): UINode => ({
  type,
  ...(key ? { key } : {}),
  props,
  ...(children ? { children } : {}),
});

export const DASHBOARD = {
  root: n("Stack", { gap: "md" }, [
    n("Heading", { text: "UK public cloud spend", level: 2 }, undefined, "h"),
    n(
      "Grid",
      { columns: 3 },
      [
        n("Metric", { label: "Total spend", value: "£4.1bn", trend: "up", caption: "vs £3.6bn" }, undefined, "m1"),
        n("Metric", { label: "YoY growth", value: "18%", trend: "up" }, undefined, "m2"),
        n("Metric", { label: "Providers", value: "41", trend: "flat" }, undefined, "m3"),
      ],
      "g",
    ),
    n("Callout", { tone: "warning", title: "Heads up", body: "Figures are illustrative." }, undefined, "c"),
    n("Chart", { kind: "bar", title: "By quarter", unit: "£m", labels: ["Q1", "Q2", "Q3"], series: [{ name: "UK", values: [12, 18, -3] }] }, undefined, "ch"),
  ]),
};

export const REPORT = {
  root: n("Stack", { gap: "lg" }, [
    n("Heading", { text: "Quarterly report", level: 1 }),
    n("Card", { title: "Regions", subtitle: "Illustrative" }, [
      n("Table", { caption: "Spend", columns: ["Region", "Spend", "Change"], rows: [["UK", "£1.2m", "+8%"], ["IE", "£0.4m", "-2%"]] }),
      n("Text", { text: "Short rows are padded.\nLine breaks stay text.", tone: "muted" }),
    ]),
    n("List", { items: ["Consolidate regions", "Renegotiate egress"], ordered: true }),
    n("Link", { label: "Full report", href: "https://example.com/report" }),
  ]),
};

export const NESTED = {
  root: n("Stack", { direction: "row", gap: "sm" }, [
    n("Badge", { text: "beta", tone: "info" }),
    n("Card", { title: "Outer" }, [
      n("Card", { title: "Inner" }, [
        n("Stack", {}, [n("Text", { text: "deep" }), n("Badge", { text: "x" })]),
      ]),
      n("Chart", { kind: "line", title: "Trend", labels: ["a", "b", "c", "d"], series: [{ name: "s1", values: [1, 3, 2, 4] }, { name: "s2", values: [2, 2, 3, 1] }] }),
    ]),
  ]),
};

export const STREAMS = { DASHBOARD, REPORT, NESTED } as const;

/**
 * The documents a client holds after each frame of streaming `doc`.
 * `step` controls granularity (characters per frame).
 */
export function frames(doc: unknown, step = 3): JsonValue[] {
  const text = JSON.stringify(doc);
  const out: JsonValue[] = [];
  let current: JsonValue | undefined;
  for (let end = step; end < text.length + step; end += step) {
    const parsed = parsePartialJson(text.slice(0, Math.min(end, text.length)));
    if (parsed.value === undefined) continue;
    const ops = diffJson(current, parsed.value);
    if (ops.length === 0) continue;
    current = applyPatch(current, ops) as JsonValue;
    out.push(current);
  }
  return out;
}

/**
 * Markup in a canonical form: attributes sorted. Attribute order carries no
 * meaning, and an attribute set late (an `href` that became valid mid-stream)
 * is appended after the others.
 */
export function canonical(root: Node): string {
  const out: string[] = [];
  const stack: (Node | string)[] = [root];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    if (item.nodeType === 3) {
      out.push(JSON.stringify((item as Text).data));
    } else if (item.nodeType === 8) {
      out.push("<!---->");
    } else if (item.nodeType === 1) {
      const el = item as Element;
      const attrs = [...el.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort();
      out.push(`<${el.namespaceURI === "http://www.w3.org/2000/svg" ? "svg:" : ""}${el.localName}${attrs.length ? " " + attrs.join(" ") : ""}>`);
      stack.push(`</${el.localName}>`);
      for (const child of [...el.childNodes].reverse()) stack.push(child);
    } else {
      for (const child of [...item.childNodes].reverse()) stack.push(child);
    }
  }
  return out.join("");
}
