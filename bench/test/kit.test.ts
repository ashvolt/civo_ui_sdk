import { describe, expect, it } from "vitest";
import { createValidator, standardContract } from "relax-ui-contract";
import { tokens, type VNode } from "relax-ui-theme-base";
import { formatCount, kitCss, kitTemplates } from "../src/kit/index.ts";
import { benchContract, KIT_TYPES } from "../src/workloads/contract.ts";
import { documentFor, framesFor, type Node } from "../src/workloads/generator.ts";
import { LADDERS, planStep } from "../src/workloads/ladders.ts";

/**
 * T-410: the bench contract's heavy visuals and the kit that draws them
 * (FR-402, spec scenario 5, plan D2).
 */

const validator = createValidator(benchContract);

function find(node: Node, type: string): Node {
  if (node.type === type) return node;
  for (const c of node.children ?? []) {
    const hit = find(c, type);
    if (hit.type === type) return hit;
  }
  return node;
}

/** The generated props of each heavy visual, from its own ladder. */
const sample = {
  Heatmap: find(documentFor({ dimension: "heatmap-cells", size: 1_000, seed: 1 }).root, "Heatmap").props,
  Scatter: find(documentFor({ dimension: "scatter-points", size: 1_000, seed: 1 }).root, "Scatter").props,
  SparklineGrid: find(documentFor({ dimension: "sparklines", size: 100, seed: 1 }).root, "SparklineGrid").props,
  AnimatedCounter: find(documentFor({ dimension: "counters", size: 10, seed: 1 }).root, "AnimatedCounter").props,
} as const;

function text(node: VNode | string): string {
  if (typeof node === "string") return node;
  return node.children.map((c) => (typeof c === "object" ? text(c as VNode) : typeof c === "string" ? c : "")).join("");
}

function all(node: VNode, f: (n: VNode) => void) {
  f(node);
  for (const c of node.children) if (typeof c === "object") all(c as VNode, f);
}

describe("the bench contract's heavy visuals", () => {
  it("extend the standard twelve without changing them", () => {
    expect(standardContract.names).toHaveLength(12);
    expect(benchContract.names).toHaveLength(16);
    for (const type of KIT_TYPES) {
      expect(standardContract.spec(type)).toBeUndefined();
      expect(benchContract.spec(type)).toBeDefined();
    }
  });

  it.each(KIT_TYPES)("%s has a schema, a role and no children", (type) => {
    expect(benchContract.role(type)).toMatch(/^[a-z]+$/);
    expect(benchContract.spec(type)!.children).toBe("none");
    expect(validator.props(type, sample[type]).ok).toBe(true);
  });

  it("refuse what a visual must not hold", () => {
    const refused: [string, unknown][] = [
      ["Heatmap", { ...sample.Heatmap, rows: Array(501).fill("r") }],
      ["Heatmap", { ...sample.Heatmap, values: [[Number.NaN]] }],
      ["Scatter", { title: "s", series: [{ name: "a", points: [[1, 2, 3]] }] }],
      ["Scatter", { title: "s", series: Array(5).fill({ name: "a", points: [] }) }],
      ["SparklineGrid", { items: Array(1_001).fill({ label: "a", values: [] }) }],
      ["AnimatedCounter", { label: "a", value: Infinity }],
      ["AnimatedCounter", { label: "<img src=x onerror=alert(1)>".repeat(5), value: 1 }],
    ];
    for (const [type, props] of refused) expect(validator.props(type, props).ok, type).toBe(false);
  });

  it.each(KIT_TYPES)("%s: the template's root carries the contract's role", (type) => {
    const template = kitTemplates[type] as (p: unknown) => VNode;
    const props = validator.props(type, sample[type]);
    expect(props.ok).toBe(true);
    const root = template(props.ok ? props.props : undefined);
    expect(root.attrs.role).toBe(benchContract.role(type));
  });

  it.each(KIT_TYPES)("%s: a partial, mid-stream props object draws without throwing", (type) => {
    const template = kitTemplates[type] as (p: unknown) => VNode;
    for (const partial of [{}, { title: "x", values: [[1]] }, { series: [{ points: [[1]] }] }, { items: [{ values: ["x"] }] }]) {
      expect(() => template(partial)).not.toThrow();
    }
  });

  it("every frame of every heavy-visual ladder draws, and grows the drawing", () => {
    for (const id of ["heatmap-cells", "scatter-points", "sparklines"] as const) {
      const frames = framesFor(planStep(LADDERS.find((l) => l.id === id)!, 100));
      const marks = frames.map((f) => {
        const node = f.root.children![1]!;
        let n = 0;
        all((kitTemplates[node.type as keyof typeof kitTemplates] as (p: unknown) => VNode)(node.props), (v) => {
          if (v.tag === "rect" || v.tag === "circle" || v.tag === "polyline") n++;
        });
        return n;
      });
      expect(marks[0]!, id).toBeLessThan(marks.at(-1)!);
    }
  });

  it("the heatmap uses every colour level and states its range in its accessible name", () => {
    const root = kitTemplates.Heatmap(sample.Heatmap as never);
    const levels = new Set<string>();
    all(root, (v) => {
      const m = /gen-heat--l(\d)/.exec(v.attrs.class ?? "");
      if (v.tag === "rect" && m) levels.add(m[1]!);
    });
    expect([...levels].sort()).toEqual(["0", "1", "2", "3", "4"]);
    expect(root.attrs["aria-label"]).toMatch(/^Heatmap: Usage by hour\. \d+ rows by \d+ columns, values from .+ to .+\.$/);
  });

  it("counters print a fixed format, the same in every renderer and locale", () => {
    expect(formatCount(1_234_567.8)).toBe("1,234,568");
    expect(formatCount(-1_000)).toBe("-1,000");
    expect(formatCount(0)).toBe("0");
    const root = kitTemplates.AnimatedCounter({ label: "Requests", value: 12_345, unit: "req", tone: "info" });
    expect(text(root)).toBe("Requests12,345 req");
    expect(root.attrs.class).toBe("gen-counter gen-counter--info");
  });
});

// --- styles ------------------------------------------------------------------

/** The rules outside every `@media` block. */
function outsideMedia(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@media", i);
    if (at < 0) return out + css.slice(i);
    out += css.slice(i, at);
    let depth = 0;
    let j = css.indexOf("{", at);
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

describe("the kit's styles", () => {
  it("write no colour of their own: tokens only (T1)", () => {
    expect(kitCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(kitCss).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|lab)\(/i);
    expect(kitCss).not.toMatch(/:\s*(white|black|red|green|blue)\b/i);
  });

  it("are scoped under the theme root", () => {
    const selectors = outsideMedia(kitCss).match(/^[^@{}\n][^{}]*(?=\{)/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(10);
    for (const s of selectors) for (const one of s.split(",")) expect(one.trim(), one).toMatch(/^\.gen-theme /);
  });

  it("animate only under prefers-reduced-motion: no-preference", () => {
    expect(outsideMedia(kitCss)).not.toMatch(/animation|@keyframes|transition/);
    expect(kitCss).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*animation:/);
  });
});

// --- contrast ----------------------------------------------------------------

type Rgb = [number, number, number];

function hex(value: string): Rgb {
  const v = value.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const c = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(in srgb, a p%, b)`. */
const mix = (a: Rgb, b: Rgb, p: number): Rgb => a.map((x, i) => Math.round(x * p + b[i]! * (1 - p))) as Rgb;

function variant(name: "light" | "dark"): Record<string, Rgb> {
  const block =
    name === "light"
      ? /^\.gen-theme \{([^}]*)\}/m.exec(tokens)![1]!
      : /\.gen-theme\[data-gen-variant="dark"\] \{([^}]*)\}/.exec(tokens)![1]!;
  const out: Record<string, Rgb> = {};
  for (const m of block.matchAll(/--gen-color-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) out[m[1]!] = hex(m[2]!);
  return out;
}

describe.each(["light", "dark"] as const)("contrast in the %s variant", (name) => {
  const t = variant(name);

  it("reads every token the kit uses", () => {
    for (const m of kitCss.matchAll(/--gen-color-([a-z0-9-]+)/g)) expect(t[m[1]!], m[1]).toBeDefined();
  });

  it("text: 4.5:1 on every background the kit draws (WCAG 1.4.3)", () => {
    for (const fg of ["on-surface", "on-surface-variant"]) {
      for (const bg of ["surface", "surface-variant"]) {
        expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("marks: 3:1 against the surface for series colours, tones and the top heat level (WCAG 1.4.11)", () => {
    for (const c of ["chart-1", "chart-2", "chart-3", "chart-4", "primary", "info", "success", "warning", "danger"]) {
      expect(contrast(t[c]!, t.surface!), c).toBeGreaterThanOrEqual(3);
    }
  });

  it("heat levels step monotonically away from the surface, so the scale reads in order", () => {
    const levels = [0.2, 0.4, 0.6, 0.8, 1].map((p) => contrast(mix(t["chart-1"]!, t.surface!, p), t.surface!));
    for (let i = 1; i < levels.length; i++) expect(levels[i]!).toBeGreaterThan(levels[i - 1]!);
    expect(levels.at(-1)!).toBeGreaterThanOrEqual(3);
  });
});
