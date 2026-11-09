import { list, text, type BaseProps } from "../props.js";

/**
 * The chart in words, apart from the chart itself.
 *
 * Its own module because the package index re-exports it: re-exporting from
 * `chart.ts` made bundlers keep the whole Chart chunk statically imported, even
 * on a page that only uses the lazy loaders (caught by T-238's bundle test).
 */

interface Series {
  name: string;
  values: number[];
}

export function seriesOf(value: unknown): Series[] {
  return list<unknown>(value)
    .slice(0, 4)
    .map((s) => {
      const entry = (typeof s === "object" && s !== null ? s : {}) as { name?: unknown; values?: unknown };
      return { name: text(entry.name) ?? "", values: list<unknown>(entry.values).map((v) => (typeof v === "number" ? v : Number.NaN)) };
    });
}

/** The chart in words: what a screen reader announces in place of the plot. */
export function describeChart(p: BaseProps["Chart"]): string {
  const unit = p.unit ?? "";
  const parts = seriesOf(p.series).map((s) => {
    const points = list<string>(p.labels).map((label, i) =>
      i < s.values.length && Number.isFinite(s.values[i]) ? `${label} ${s.values[i]}${unit}` : null,
    );
    return `${s.name}: ${points.filter((v) => v !== null).join(", ")}`;
  });
  const out = `${p.title} (${p.kind} chart). ${parts.join("; ")}.`;
  return out.length > 1_000 ? `${out.slice(0, 997)}...` : out;
}

