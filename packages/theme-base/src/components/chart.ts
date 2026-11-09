import { list, oneOf, text, type BaseProps } from "../props.js";
import { describeChart, seriesOf } from "./describe.js";
import { h, type VNode } from "../vnode.js";

/** Plain SVG, no chart library. The largest base component, so its own chunk. */

const W = 600;
const H = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 8 };

export function Chart(p: BaseProps["Chart"]): VNode {
  const kind = oneOf(p.kind, ["bar", "line"], "bar");
  const labels = list<unknown>(p.labels).map((l) => text(l) ?? "");
  const series = seriesOf(p.series);
  const n = Math.max(labels.length, 1);
  const values = series.flatMap((s) => s.values.slice(0, n)).filter(Number.isFinite);
  const lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (hi === lo) hi = lo + 1;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => round(PAD.top + ((hi - v) / (hi - lo)) * plotH);
  const band = plotW / n;
  const cx = (i: number) => round(PAD.left + band * (i + 0.5));

  const marks: VNode[] = [];
  if (kind === "bar") {
    const barW = (band * 0.8) / Math.max(series.length, 1);
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
  const step = Math.ceil(labels.length / 12) || 1;
  const axisLabels = labels
    .map((label, i) => (i % step === 0 ? h("text", { class: "gen-chart__label", x: cx(i), y: H - 8 }, label) : null))
    .filter((v): v is VNode => v !== null);

  const title = text(p.title);
  return h(
    "figure",
    {
      class: `gen-chart gen-chart--${kind}`,
      role: "img",
      "aria-label": describeChart({ kind, title: title ?? "", unit: text(p.unit), labels, series }),
    },
    h("figcaption", { class: "gen-chart__title" }, title),
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export default Chart;
