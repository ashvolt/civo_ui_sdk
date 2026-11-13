import { nothing, type TemplateResult } from "lit";
import { Directive, directive, type ElementPart, type PartInfo, PartType } from "lit/directive.js";
import { html, svg, unsafeStatic, type StaticValue } from "lit/static-html.js";
import { CHILDREN, SVG_TAGS, type VNode } from "relax-ui-theme-base";
import { allTemplates, cleanProps } from "./react.ts";

/**
 * The kit drawn by Lit (plan D2, T-430): each template as a Lit template, its
 * tag static and its attributes set by a directive, so a Lit element draws the
 * same elements, classes and text as the reference. SVG elements below the
 * `<svg>` are written with Lit's `svg` tag, as Lit requires, so they are made
 * in the SVG namespace. Nothing is added: no URL guard, no attribute filter.
 */

/** Sets an element's attributes to exactly `attrs`, removing ones no longer given. */
class AttrsDirective extends Directive {
  private names: string[] = [];
  constructor(part: PartInfo) {
    super(part);
    if (part.type !== PartType.ELEMENT) throw new Error("attrs() goes on an element");
  }
  render(_attrs: Record<string, string>) {
    return nothing;
  }
  override update(part: ElementPart, [attrs]: [Record<string, string>]) {
    const el = part.element;
    for (const name of this.names) if (!(name in attrs)) el.removeAttribute(name);
    for (const [name, value] of Object.entries(attrs)) if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    this.names = Object.keys(attrs);
    return nothing;
  }
}
const attrs = directive(AttrsDirective);

const tags = new Map<string, StaticValue>();
const tagOf = (name: string) => {
  let t = tags.get(name);
  if (!t) tags.set(name, (t = unsafeStatic(name)));
  return t;
};

function toLit(node: VNode, children: unknown, inSvg: boolean): TemplateResult {
  const tag = tagOf(node.tag);
  // Below an <svg>, a template is an SVG fragment.
  const childInSvg = inSvg || node.tag === "svg";
  const kids = node.children.map((c) => (c === CHILDREN ? children : typeof c === "string" ? c : toLit(c, children, childInSvg)));
  const write = inSvg && SVG_TAGS.has(node.tag) ? svg : html;
  return write`<${tag} ${attrs(node.attrs)}>${kids}</${tag}>`;
}

/** Draws one kit component, its children placed where the template puts them. */
export function drawLit(type: string, props: Record<string, unknown> | undefined, children?: unknown): TemplateResult | typeof nothing {
  const template = allTemplates[type];
  return template ? toLit(template(cleanProps(props) as never), children ?? nothing, false) : nothing;
}
