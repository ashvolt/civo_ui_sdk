import { h, type VNode } from "relax-ui-theme-base";

/**
 * The four heavy visuals (plan D2, FR-402): markup as data, like the base
 * theme's own templates, so every renderer and every contender draws the same
 * elements, classes and text from them.
 *
 * Same rules as the base theme: props are the contract's validated shape but
 * may be partial mid-stream; styling is by class only, and every class reads
 * base-theme tokens (`css.ts`); each root carries the role the bench contract
 * names. Plain SVG, no chart library.
 */

export interface KitProps {
  Heatmap: { title: string; unit?: string; rows: string[]; columns: string[]; values: number[][] };
  Scatter: { title: string; xLabel?: string; yLabel?: string; series: { name: string; points: [number, number][] }[] };
  SparklineGrid: { title?: string; items: { label: string; values: number[] }[] };
  AnimatedCounter: { label: string; value: number; unit?: string; tone: "neutral" | "info" | "success" | "warning" | "danger" };
}

export type KitName = keyof KitProps;

const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const round = (v: number) => Math.round(v * 100) / 100;

/** `1234567.8` → `1,234,568`: fixed, so every renderer prints the same text. */
export function formatCount(value: number): string {
  const n = Math.round(Math.abs(value));
  const grouped = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return value < 0 && n !== 0 ? `-${grouped}` : grouped;
}

/** Five colour levels; level 4 is the full series colour. */
export const HEAT_LEVELS = 5;

export function Heatmap(p: KitProps["Heatmap"]): VNode {
  const title = text(p.title) ?? "";
  const columns = list<unknown>(p.columns).map((c) => text(c) ?? "");
  const rows = list<unknown>(p.rows).map((r) => text(r) ?? "");
  const values = list<unknown>(p.values).slice(0, rows.length).map((r) => list<unknown>(r).slice(0, columns.length).map(num));
  const all = values.flat().filter((v): v is number => v !== undefined);
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 0;
  const span = hi - lo || 1;
  const unit = text(p.unit);
  const fmt = (v: number) => (unit ? `${formatCount(v)} ${unit}` : formatCount(v));

  const cells: VNode[] = [];
  values.forEach((row, y) =>
    row.forEach((v, x) => {
      if (v === undefined) return;
      const level = Math.min(HEAT_LEVELS - 1, Math.floor(((v - lo) / span) * HEAT_LEVELS));
      cells.push(h("rect", { class: `gen-heat__cell gen-heat--l${level}`, x, y, width: 1, height: 1 }));
    }),
  );
  const summary =
    `Heatmap: ${title}. ${rows.length} rows by ${columns.length} columns` +
    (all.length ? `, values from ${fmt(lo)} to ${fmt(hi)}.` : ".");
  return h(
    "figure",
    { class: "gen-heat", role: "img", "aria-label": summary },
    h("figcaption", { class: "gen-heat__title" }, title),
    h(
      "svg",
      {
        class: "gen-heat__plot",
        viewBox: `0 0 ${Math.max(columns.length, 1)} ${Math.max(rows.length, 1)}`,
        preserveAspectRatio: "none",
        "aria-hidden": "true",
        focusable: "false",
      },
      ...cells,
    ),
    h(
      "ul",
      { class: "gen-heat__legend", "aria-hidden": "true" },
      ...Array.from({ length: HEAT_LEVELS }, (_, l) =>
        h("li", {}, h("span", { class: `gen-heat__swatch gen-heat--l${l}` }), fmt(lo + (span * l) / HEAT_LEVELS)),
      ),
    ),
  );
}

const SW = 600;
const SH = 240;
const SPAD = 8;

export function Scatter(p: KitProps["Scatter"]): VNode {
  const title = text(p.title) ?? "";
  const series = list<{ name?: unknown; points?: unknown }>(p.series).slice(0, 4).map((s) => ({
    name: text(s?.name) ?? "",
    points: list<unknown>(s?.points)
      .map((pt) => list<unknown>(pt))
      .filter((pt) => num(pt[0]) !== undefined && num(pt[1]) !== undefined) as [number, number][],
  }));
  const xs = series.flatMap((s) => s.points.map((pt) => pt[0]));
  const ys = series.flatMap((s) => s.points.map((pt) => pt[1]));
  const [x0, x1] = xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1];
  const [y0, y1] = ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 1];
  const sx = (v: number) => round(SPAD + ((v - x0) / (x1 - x0 || 1)) * (SW - 2 * SPAD));
  const sy = (v: number) => round(SH - SPAD - ((v - y0) / (y1 - y0 || 1)) * (SH - 2 * SPAD));
  const marks = series.flatMap((s, si) =>
    s.points.map((pt) => h("circle", { class: `gen-scatter__pt gen-chart--s${si + 1}`, cx: sx(pt[0]), cy: sy(pt[1]), r: 3 })),
  );
  const xLabel = text(p.xLabel) ?? "x";
  const yLabel = text(p.yLabel) ?? "y";
  const summary =
    `Scatter plot: ${title}. ${xs.length} points in ${series.length} series` +
    (xs.length ? `; ${xLabel} from ${formatCount(x0)} to ${formatCount(x1)}, ${yLabel} from ${formatCount(y0)} to ${formatCount(y1)}.` : ".");
  return h(
    "figure",
    { class: "gen-chart gen-scatter", role: "img", "aria-label": summary },
    h("figcaption", { class: "gen-chart__title" }, title),
    h(
      "svg",
      { class: "gen-chart__plot", viewBox: `0 0 ${SW} ${SH}`, preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" },
      ...marks,
    ),
    series.length > 1 &&
      h(
        "ul",
        { class: "gen-chart__legend", "aria-hidden": "true" },
        ...series.map((s, si) => h("li", {}, h("span", { class: `gen-chart__swatch gen-chart--s${si + 1}` }), s.name)),
      ),
  );
}

export function SparklineGrid(p: KitProps["SparklineGrid"]): VNode {
  const title = text(p.title);
  const items = list<{ label?: unknown; values?: unknown }>(p.items).map((it, i) => {
    const label = text(it?.label) ?? "";
    const values = list<unknown>(it?.values).map(num).filter((v): v is number => v !== undefined);
    const lo = values.length ? Math.min(...values) : 0;
    const hi = values.length ? Math.max(...values) : 1;
    const step = 100 / Math.max(values.length - 1, 1);
    const points = values.map((v, j) => `${round(j * step)},${round(22 - ((v - lo) / (hi - lo || 1)) * 20)}`).join(" ");
    const last = values.length ? formatCount(values[values.length - 1]!) : "";
    return h(
      "li",
      { class: "gen-spark" },
      h("span", { class: "gen-spark__label" }, label),
      h(
        "svg",
        { class: "gen-spark__plot", viewBox: "0 0 100 24", preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" },
        values.length > 0 && h("polyline", { class: `gen-chart__line gen-chart--s${(i % 4) + 1}`, points }),
      ),
      h("span", { class: "gen-spark__value" }, last),
    );
  });
  return h("ul", { class: "gen-sparks", role: "list", "aria-label": title ?? "Sparklines" }, ...items);
}

const COUNTER_TONES = ["neutral", "info", "success", "warning", "danger"] as const;

/**
 * A number that rolls in when it appears, with a live bar that pulses while
 * it is on screen. CSS animation only, and only under
 * `prefers-reduced-motion: no-preference` (spec scenario 5).
 */
export function AnimatedCounter(p: KitProps["AnimatedCounter"]): VNode {
  const label = text(p.label) ?? "";
  const value = num(p.value);
  const unit = text(p.unit);
  const tone = COUNTER_TONES.includes(p.tone) ? p.tone : "neutral";
  const shown = value === undefined ? "" : unit ? `${formatCount(value)} ${unit}` : formatCount(value);
  return h(
    "div",
    { class: `gen-counter gen-counter--${tone}`, role: "group", "aria-label": label },
    h("p", { class: "gen-counter__label" }, label),
    h("p", { class: "gen-counter__value" }, shown),
    h("span", { class: "gen-counter__bar", "aria-hidden": "true" }),
  );
}

export const kitTemplates = { Heatmap, Scatter, SparklineGrid, AnimatedCounter } as const;
