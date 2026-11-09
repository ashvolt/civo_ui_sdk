/**
 * Markup as data.
 *
 * A base-theme component is a function from validated props to a small tree
 * of these, not to DOM nodes or React elements. That is what lets one
 * implementation serve every backend: React turns a tree into elements today,
 * the DOM backend into nodes in phase 4, and a test can inspect it with no DOM
 * at all.
 *
 * Model text appears only as a string child (a text node) or an attribute
 * value. A backend never parses either as markup: there is no way to express
 * raw HTML in this type.
 */

/** Where the node's children go. At most once per template. */
export const CHILDREN: unique symbol = Symbol.for("relax-ui.children") as never;

export type VChild = VNode | string | typeof CHILDREN;

export interface VNode {
  tag: string;
  attrs: Readonly<Record<string, string>>;
  children: readonly VChild[];
}

/** Builds a node, dropping attributes whose value is undefined or false. */
export function h(
  tag: string,
  attrs: Record<string, string | number | false | undefined> = {},
  ...children: (VChild | false | null | undefined)[]
): VNode {
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    clean[name] = String(value);
  }
  return {
    tag,
    attrs: clean,
    children: children.filter((child): child is VChild => child !== undefined && child !== null && child !== false),
  };
}

/** SVG elements a backend must create in the SVG namespace. */
export const SVG_TAGS: ReadonlySet<string> = new Set(["svg", "g", "rect", "line", "polyline", "circle", "text"]);
