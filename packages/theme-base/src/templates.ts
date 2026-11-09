import { CHILDREN, h, type VNode } from "./vnode.js";

/**
 * The base theme's twelve components (FR-230).
 *
 * Each takes props that have already passed the contract's schema, and returns
 * markup as data. Styling is by class only; every class reads design tokens
 * (`css.ts`), so nothing here knows about colour, variant or density, and a
 * variant switch never re-renders (FR-232).
 *
 * Each root carries the role the contract names for its component (FR-214),
 * explicitly even where the element implies it, so a connector replacing the
 * element cannot lose it unnoticed.
 */

type Tone = "info" | "success" | "warning" | "danger";

export interface BaseProps {
  Stack: { gap: "sm" | "md" | "lg"; direction: "column" | "row" };
  Grid: { columns: number };
  Card: { title?: string; subtitle?: string };
  Heading: { text: string; level: number };
  Text: { text: string; tone: "default" | "muted" };
  Metric: { label: string; value: string; trend?: "up" | "down" | "flat"; caption?: string };
  List: { items: string[]; ordered: boolean };
  Table: { caption?: string; columns: string[]; rows: string[][] };
  Callout: { tone: Tone; title: string; body: string };
  Badge: { text: string; tone: "neutral" | Tone };
  Link: { label: string; href: string };
  Chart: {
    kind: "bar" | "line";
    title: string;
    unit?: string;
    labels: string[];
    series: { name: string; values: number[] }[];
  };
}

export type BaseComponentName = keyof BaseProps;
export type Template<P> = (props: P) => VNode;
export type BaseTemplates = { [K in BaseComponentName]: Template<BaseProps[K]> };

const TREND = {
  up: { glyph: "▲", label: "up" },
  down: { glyph: "▼", label: "down" },
  flat: { glyph: "▬", label: "flat" },
} as const;

export const baseTemplates: BaseTemplates = {
  Stack: (p) =>
    h("div", { class: `gen-stack gen-stack--${p.direction} gen-gap--${p.gap}`, role: "group" }, CHILDREN),

  Grid: (p) =>
    // A class per column count rather than an inline style: inline styles are
    // refused under a strict `style-src`, and this must render under any CSP.
    h("div", { class: `gen-grid gen-grid--${clampInt(p.columns, 1, 4)}`, role: "group" }, CHILDREN),

  Card: (p) =>
    h(
      "section",
      { class: "gen-card", role: "region", "aria-label": p.title },
      p.title !== undefined && h("p", { class: "gen-card__title" }, p.title),
      p.subtitle !== undefined && h("p", { class: "gen-card__subtitle" }, p.subtitle),
      h("div", { class: "gen-card__body" }, CHILDREN),
    ),

  Heading: (p) => {
    const level = clampInt(p.level, 1, 4);
    return h(`h${level}`, { class: `gen-heading gen-heading--${level}`, role: "heading", "aria-level": level }, p.text);
  },

  Text: (p) => h("p", { class: `gen-text gen-text--${p.tone}`, role: "paragraph" }, p.text),

  Metric: (p) =>
    h(
      "div",
      { class: "gen-metric", role: "group", "aria-label": p.label },
      h("p", { class: "gen-metric__label" }, p.label),
      h(
        "p",
        { class: "gen-metric__value" },
        p.value,
        p.trend &&
          h(
            "span",
            { class: `gen-metric__trend gen-metric__trend--${p.trend}`, role: "img", "aria-label": `trend ${TREND[p.trend].label}` },
            TREND[p.trend].glyph,
          ),
      ),
      p.caption !== undefined && h("p", { class: "gen-metric__caption" }, p.caption),
    ),

  List: (p) =>
    h(p.ordered ? "ol" : "ul", { class: "gen-list", role: "list" }, ...p.items.map((item) => h("li", {}, item))),

  // The table is the root, so it carries the role. Cells wrap rather than
  // the table scrolling: eight bounded columns fit, and a block-displayed
  // table loses its semantics in some browsers.
  Table: (p) =>
    h(
      "table",
      { class: "gen-table", role: "table" },
      p.caption !== undefined && h("caption", {}, p.caption),
      h("thead", {}, h("tr", {}, ...p.columns.map((c) => h("th", { scope: "col" }, c)))),
      h(
        "tbody",
        {},
        // One cell per column, whatever the row holds: a short row is padded
        // so the grid stays aligned while a document is still streaming.
        ...p.rows.map((row) => h("tr", {}, ...p.columns.map((_, i) => h("td", {}, row[i] ?? "")))),
      ),
    ),

  Callout: (p) =>
    h(
      "aside",
      { class: `gen-callout gen-tone--${p.tone}`, role: "note" },
      h("p", { class: "gen-callout__title" }, p.title),
      h("p", { class: "gen-callout__body" }, p.body),
    ),

  Badge: (p) => h("span", { class: `gen-badge gen-tone--${p.tone}`, role: "note" }, p.text),

  Link: (p) =>
    // `href` passed the contract's URL guard; `rel` is belt and braces.
    h("a", { class: "gen-link", role: "link", href: p.href, rel: "noopener noreferrer nofollow", target: "_blank" }, p.label),

  Chart: (p) => chart(p),
};

// --- Chart: plain SVG, no library -------------------------------------------

const W = 600;
const H = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 8 };

function chart(p: BaseProps["Chart"]): VNode {
  const labels = p.labels;
  const series = p.series.slice(0, 4);
  const n = Math.max(labels.length, 1);
  const values = series.flatMap((s) => s.values.slice(0, n)).filter(Number.isFinite);
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (hi === lo) hi = lo + 1;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => round(PAD.top + ((hi - v) / (hi - lo)) * plotH);
  const band = plotW / n;
  const cx = (i: number) => round(PAD.left + band * (i + 0.5));

  const marks: VNode[] = [];
  if (p.kind === "bar") {
    const barW = (band * 0.8) / series.length;
    series.forEach((s, si) => {
      s.values.slice(0, n).forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        const top = y(Math.max(v, 0));
        const bottom = y(Math.min(v, 0));
        marks.push(
          h("rect", {
            class: `gen-chart__bar gen-chart--s${si + 1}`,
            x: round(PAD.left + band * i + band * 0.1 + barW * si),
            y: top,
            width: round(Math.max(barW - 1, 1)),
            height: round(Math.max(bottom - top, 0.5)),
          }),
        );
      });
    });
  } else {
    series.forEach((s, si) => {
      const points = s.values
        .slice(0, n)
        .map((v, i) => (Number.isFinite(v) ? `${cx(i)},${y(v)}` : null))
        .filter((pt): pt is string => pt !== null);
      if (points.length > 0) {
        marks.push(h("polyline", { class: `gen-chart__line gen-chart--s${si + 1}`, points: points.join(" ") }));
      }
    });
  }

  // At most twelve axis labels; the rest are in the accessible name.
  const step = Math.ceil(labels.length / 12);
  const axisLabels = labels
    .map((label, i) => (i % step === 0 ? h("text", { class: "gen-chart__label", x: cx(i), y: H - 8 }, label) : null))
    .filter((v): v is VNode => v !== null);

  return h(
    "figure",
    { class: `gen-chart gen-chart--${p.kind}`, role: "img", "aria-label": describeChart(p) },
    h("figcaption", { class: "gen-chart__title" }, p.title),
    h(
      "svg",
      { class: "gen-chart__plot", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" },
      h("line", { class: "gen-chart__axis", x1: PAD.left, x2: W - PAD.right, y1: y(0), y2: y(0) }),
      ...marks,
      ...axisLabels,
    ),
    series.length > 1 &&
      h(
        "ul",
        { class: "gen-chart__legend", "aria-hidden": "true" },
        ...series.map((s, si) => h("li", {}, h("span", { class: `gen-chart__swatch gen-chart--s${si + 1}` }), s.name)),
      ),
  );
}

/** The chart in words: what a screen reader announces in place of the plot. */
export function describeChart(p: BaseProps["Chart"]): string {
  const unit = p.unit ?? "";
  const parts = p.series.slice(0, 4).map((s) => {
    const points = p.labels.map((label, i) => (i < s.values.length ? `${label} ${s.values[i]}${unit}` : null));
    return `${s.name}: ${points.filter((v) => v !== null).join(", ")}`;
  });
  const text = `${p.title} (${p.kind} chart). ${parts.join("; ")}.`;
  return text.length > 1_000 ? `${text.slice(0, 997)}...` : text;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
