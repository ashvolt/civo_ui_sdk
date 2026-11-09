import { clampInt, oneOf, text, type BaseProps } from "../props.js";
import { CHILDREN, h, type VNode } from "../vnode.js";

/** The containers. Small, and on almost every document: loaded together. */

export function Stack(p: BaseProps["Stack"]): VNode {
  const direction = oneOf(p.direction, ["column", "row"], "column");
  const gap = oneOf(p.gap, ["sm", "md", "lg"], "md");
  return h("div", { class: `gen-stack gen-stack--${direction} gen-gap--${gap}`, role: "group" }, CHILDREN);
}

export function Grid(p: BaseProps["Grid"]): VNode {
  // A class per column count rather than an inline style: inline styles are
  // refused under a strict `style-src`, and this must render under any CSP.
  return h("div", { class: `gen-grid gen-grid--${clampInt(p.columns, 1, 4, 3)}`, role: "group" }, CHILDREN);
}

export function Card(p: BaseProps["Card"]): VNode {
  const title = text(p.title);
  const subtitle = text(p.subtitle);
  return h(
    "section",
    { class: "gen-card", role: "region", "aria-label": title },
    title !== undefined && h("p", { class: "gen-card__title" }, title),
    subtitle !== undefined && h("p", { class: "gen-card__subtitle" }, subtitle),
    h("div", { class: "gen-card__body" }, CHILDREN),
  );
}
