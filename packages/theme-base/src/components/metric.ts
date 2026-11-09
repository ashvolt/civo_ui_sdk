import { oneOf, text, type BaseProps } from "../props.js";
import { h, type VNode } from "../vnode.js";

const TREND = {
  up: { glyph: "▲", label: "up" },
  down: { glyph: "▼", label: "down" },
  flat: { glyph: "▬", label: "flat" },
} as const;

export function Metric(p: BaseProps["Metric"]): VNode {
  const label = text(p.label);
  const caption = text(p.caption);
  const trend = p.trend === undefined ? undefined : oneOf(p.trend, ["up", "down", "flat"], "flat");
  return h(
    "div",
    { class: "gen-metric", role: "group", "aria-label": label },
    h("p", { class: "gen-metric__label" }, label),
    h(
      "p",
      { class: "gen-metric__value" },
      text(p.value),
      trend &&
        h(
          "span",
          { class: `gen-metric__trend gen-metric__trend--${trend}`, role: "img", "aria-label": `trend ${TREND[trend].label}` },
          TREND[trend].glyph,
        ),
    ),
    caption !== undefined && h("p", { class: "gen-metric__caption" }, caption),
  );
}

export default Metric;
