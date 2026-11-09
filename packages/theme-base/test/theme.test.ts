import { standardContract, STANDARD_COMPONENT_NAMES } from "relax-ui-contract";
import {
  baseTemplates,
  CHILDREN,
  components,
  describeChart,
  themeAttributes,
  tokens,
  type BaseProps,
  type VChild,
  type VNode,
} from "relax-ui-theme-base";
import { describe, expect, it } from "vitest";

// --- fixtures ------------------------------------------------------------------

const HOSTILE = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;

/** Props for every component, as the contract would hand them over. */
const SAMPLE: { [K in keyof BaseProps]: BaseProps[K] } = {
  Stack: { gap: "md", direction: "column" },
  Grid: { columns: 3 },
  Card: { title: "Notes", subtitle: "Q3" },
  Heading: { text: "Spend", level: 2 },
  Text: { text: "Plain text.", tone: "muted" },
  Metric: { label: "Total", value: "£4.1bn", trend: "up", caption: "vs Q2" },
  List: { items: ["a", "b"], ordered: false },
  Table: { caption: "By region", columns: ["Region", "Spend"], rows: [["UK", "£1m"], ["IE"]] },
  Callout: { tone: "warning", title: "Heads up", body: "Illustrative." },
  Badge: { text: "beta", tone: "info" },
  Link: { label: "Source", href: "https://example.com/r" },
  Chart: { kind: "bar", title: "Spend", unit: "%", labels: ["Q1", "Q2", "Q3"], series: [{ name: "UK", values: [3, -1, 4] }] },
};

const render = <K extends keyof BaseProps>(name: K, props: BaseProps[K] = SAMPLE[name]) =>
  (baseTemplates[name] as (p: BaseProps[K]) => VNode)(props);

function walk(node: VNode, visit: (n: VNode) => void): void {
  const stack: VNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    visit(n);
    for (const c of n.children) if (typeof c === "object") stack.push(c as VNode);
  }
}
const texts = (node: VNode) => {
  const out: string[] = [];
  walk(node, (n) => n.children.forEach((c) => typeof c === "string" && out.push(c)));
  return out;
};

// --- tokens and contrast (T-223) ----------------------------------------------

/** Custom properties declared in the first block matching `selector`. */
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--gen-[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const LIGHT = block(tokens, ".gen-theme");
const DARK = { ...LIGHT, ...block(tokens, '.gen-theme[data-gen-variant="dark"]') };
const COMPACT = { ...LIGHT, ...block(tokens, '.gen-theme[data-gen-density="compact"]') };
const AUTO_DARK = { ...LIGHT, ...block(tokens, '  .gen-theme[data-gen-variant="auto"]') };

function luminance(hex: string): number {
  const v = hex.replace("#", "");
  const full = v.length === 3 ? [...v].map((c) => c + c).join("") : v;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * Every foreground/background pair a component draws. Text needs 4.5:1;
 * chart marks are graphics and need 3:1 (WCAG 2.2 1.4.3, 1.4.11).
 */
const TEXT_PAIRS: [string, string][] = [
  ["on-surface", "surface"],
  ["on-surface", "surface-variant"],
  ["on-surface-variant", "surface"],
  ["on-surface-variant", "surface-variant"],
  ["primary", "surface"],
  ["primary", "surface-variant"],
  ["success", "surface-variant"],
  ["danger", "surface-variant"],
  ["on-neutral-container", "neutral-container"],
  ["on-info-container", "info-container"],
  ["on-success-container", "success-container"],
  ["on-warning-container", "warning-container"],
  ["on-danger-container", "danger-container"],
];
const GRAPHIC_PAIRS: [string, string][] = [1, 2, 3, 4].map((i) => [`chart-${i}`, "surface-variant"]);

describe("design tokens (T-223)", () => {
  it("component CSS contains no literal colour (T1)", () => {
    expect(components).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(components).not.toMatch(/\b(rgba?|hsla?|oklch|lab|lch|color-mix)\(/i);
    expect(components).not.toMatch(/:\s*(white|black|red|green|blue|gray|grey|orange|purple|yellow)\b/i);
  });

  it("every token a component reads is defined", () => {
    const local = new Set(["--gen-tone", "--gen-tone-container", "--gen-on-tone-container", "--gen-series"]);
    for (const [, name] of components.matchAll(/var\((--gen-[a-z0-9-]+)\)/g)) {
      if (local.has(name!)) continue;
      expect(LIGHT, name).toHaveProperty(name!);
    }
  });

  it("dark defines every colour light does, and compact changes no colour", () => {
    const colours = (t: Record<string, string>) => Object.keys(t).filter((k) => k.startsWith("--gen-color-"));
    expect(colours(block(tokens, '.gen-theme[data-gen-variant="dark"]')).sort()).toEqual(colours(LIGHT).sort());
    expect(colours(block(tokens, '.gen-theme[data-gen-density="compact"]'))).toEqual([]);
  });

  it("auto follows the system with the same dark values", () => {
    expect(AUTO_DARK).toEqual(DARK);
    expect(tokens).toContain("@media (prefers-color-scheme: dark)");
  });

  it.each([
    ["light", LIGHT],
    ["dark", DARK],
    ["compact", COMPACT],
  ])("%s: every text pair meets 4.5:1 and every chart colour 3:1 (NFR-205)", (_variant, t) => {
    const colour = (role: string) => t[`--gen-color-${role}`]!;
    for (const [fg, bg] of TEXT_PAIRS) {
      expect(contrast(colour(fg), colour(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const [fg, bg] of GRAPHIC_PAIRS) {
      expect(contrast(colour(fg), colour(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("every selector is scoped under .gen-theme, so nothing else on the page is styled", () => {
    const css = `${tokens}\n${components}`.replace(/@(media|container)[^{]+\{/g, "");
    for (const [, selectors] of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      for (const selector of selectors!.split(",").map((s) => s.trim()).filter(Boolean)) {
        expect(selector, selector).toMatch(/^\.gen-theme\b/);
      }
    }
  });

  it("the root attributes carry variant and density, nothing else changes (FR-232)", () => {
    expect(themeAttributes("dark", "compact")).toEqual({
      class: "gen-theme",
      "data-gen-variant": "dark",
      "data-gen-density": "compact",
    });
    // Templates take props only: no variant can reach markup, so switching one
    // can only restyle, never re-render.
    for (const name of STANDARD_COMPONENT_NAMES) expect(baseTemplates[name].length).toBe(1);
  });
});

// --- the twelve implementations (T-224) --------------------------------------

const TAGS = new Set([
  "div", "section", "aside", "figure", "figcaption", "p", "span", "h1", "h2", "h3", "h4",
  "ul", "ol", "li", "table", "caption", "thead", "tbody", "tr", "th", "td", "a",
  "svg", "line", "rect", "polyline", "text",
]);
const ATTRS = /^(class|role|href|rel|target|scope|viewBox|preserveAspectRatio|focusable|x|y|x1|x2|y1|y2|width|height|points|aria-[a-z]+)$/;

describe("base implementations (T-224)", () => {
  it("implements exactly the contract's twelve", () => {
    expect(Object.keys(baseTemplates).sort()).toEqual([...STANDARD_COMPONENT_NAMES].sort());
  });

  it.each([...STANDARD_COMPONENT_NAMES])("%s: root carries the contract's role (FR-214)", (name) => {
    expect(render(name).attrs.role).toBe(standardContract.role(name));
  });

  it.each([...STANDARD_COMPONENT_NAMES])("%s: only allowlisted tags and attributes", (name) => {
    walk(render(name), (n) => {
      expect(TAGS.has(n.tag), n.tag).toBe(true);
      for (const attr of Object.keys(n.attrs)) expect(attr, `${n.tag}[${attr}]`).toMatch(ATTRS);
    });
  });

  it("containers place children exactly once; leaves never", () => {
    const slots = (n: VNode) => {
      let count = 0;
      walk(n, (x) => x.children.forEach((c: VChild) => c === CHILDREN && count++));
      return count;
    };
    for (const name of STANDARD_COMPONENT_NAMES) {
      const policy = standardContract.spec(name)!.children;
      expect(slots(render(name)), name).toBe(policy === "none" ? 0 : 1);
    }
  });

  it("model text stays text: never a tag, never an attribute name", () => {
    const node = render("Text", { text: HOSTILE, tone: "default" });
    expect(texts(node)).toEqual([HOSTILE]);
    walk(node, (n) => expect(n.tag).not.toMatch(/img|script/));
    const metric = render("Metric", { label: HOSTILE, value: HOSTILE, caption: HOSTILE });
    walk(metric, (n) => expect(n.tag).not.toMatch(/img|script/));
  });

  it("is a pure function of props", () => {
    for (const name of STANDARD_COMPONENT_NAMES) expect(render(name)).toEqual(render(name));
  });

  it("Table pads short rows so cells stay under their column", () => {
    const rows: VNode[] = [];
    walk(render("Table"), (n) => n.tag === "tr" && rows.push(n));
    expect(rows.map((r) => r.children.length)).toEqual([2, 2, 2]);
  });

  it("Heading maps level to h1..h4 and clamps", () => {
    expect(render("Heading", { text: "x", level: 3 }).tag).toBe("h3");
    expect(render("Heading", { text: "x", level: 9 }).tag).toBe("h4");
  });

  describe("Chart (plain SVG)", () => {
    const marks = (node: VNode, tag: string) => {
      const out: VNode[] = [];
      walk(node, (n) => n.tag === tag && out.push(n));
      return out;
    };

    it("draws one bar per value, below the axis for a negative", () => {
      const bars = marks(render("Chart"), "rect");
      expect(bars).toHaveLength(3);
      const axisY = Number(marks(render("Chart"), "line")[0]!.attrs.y1);
      const negative = bars[1]!;
      expect(Number(negative.attrs.y)).toBeCloseTo(axisY, 5);
      expect(Number(bars[0]!.attrs.y)).toBeLessThan(axisY);
    });

    it("draws one line per series", () => {
      const node = render("Chart", {
        kind: "line",
        title: "t",
        labels: ["a", "b"],
        series: [
          { name: "x", values: [1, 2] },
          { name: "y", values: [2, 1] },
        ],
      });
      const lines = marks(node, "polyline");
      expect(lines).toHaveLength(2);
      expect(lines[0]!.attrs.points!.split(" ")).toHaveLength(2);
      expect(marks(node, "li")).toHaveLength(2); // legend
    });

    it("is described in words for assistive technology", () => {
      expect(render("Chart").attrs["aria-label"]).toBe("Spend (bar chart). UK: Q1 3%, Q2 -1%, Q3 4%.");
      expect(describeChart({ ...SAMPLE.Chart, title: "x".repeat(2_000) }).length).toBeLessThanOrEqual(1_000);
    });

    it("thins axis labels to at most twelve", () => {
      const labels = Array.from({ length: 24 }, (_, i) => `p${i}`);
      const node = render("Chart", { kind: "bar", title: "t", labels, series: [{ name: "s", values: labels.map((_, i) => i) }] });
      expect(marks(node, "text").length).toBeLessThanOrEqual(12);
    });

    it("survives all-zero and empty series without dividing by zero", () => {
      for (const values of [[0, 0, 0], []]) {
        const node = render("Chart", { kind: "line", title: "t", labels: ["a", "b", "c"], series: [{ name: "s", values }] });
        walk(node, (n) => Object.values(n.attrs).forEach((v) => expect(v).not.toMatch(/NaN|Infinity/)));
      }
    });
  });
});
