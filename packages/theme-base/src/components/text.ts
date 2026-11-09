import { clampInt, list, oneOf, text, type BaseProps } from "../props.js";
import { h, type VNode } from "../vnode.js";

/** Text-only components: heading, paragraph, list, link, badge, callout. */

export function Heading(p: BaseProps["Heading"]): VNode {
  const level = clampInt(p.level, 1, 4, 2);
  return h(`h${level}`, { class: `gen-heading gen-heading--${level}`, role: "heading", "aria-level": level }, text(p.text));
}

export function Text(p: BaseProps["Text"]): VNode {
  const tone = oneOf(p.tone, ["default", "muted"], "default");
  return h("p", { class: `gen-text gen-text--${tone}`, role: "paragraph" }, text(p.text));
}

export function List(p: BaseProps["List"]): VNode {
  return h(
    p.ordered === true ? "ol" : "ul",
    { class: "gen-list", role: "list" },
    ...list<unknown>(p.items).map((item) => h("li", {}, text(item))),
  );
}

export function Link(p: BaseProps["Link"]): VNode {
  // `href` passed the contract's URL guard (or came from a trusted route), and
  // every renderer checks it again; `rel` is belt and braces.
  return h(
    "a",
    { class: "gen-link", role: "link", href: text(p.href), rel: "noopener noreferrer nofollow", target: "_blank" },
    text(p.label),
  );
}

const TONES = ["neutral", "info", "success", "warning", "danger"] as const;

export function Badge(p: BaseProps["Badge"]): VNode {
  return h("span", { class: `gen-badge gen-tone--${oneOf(p.tone, TONES, "neutral")}`, role: "note" }, text(p.text));
}

export function Callout(p: BaseProps["Callout"]): VNode {
  return h(
    "aside",
    { class: `gen-callout gen-tone--${oneOf(p.tone, ["info", "success", "warning", "danger"], "info")}`, role: "note" },
    h("p", { class: "gen-callout__title" }, text(p.title)),
    h("p", { class: "gen-callout__body" }, text(p.body)),
  );
}
