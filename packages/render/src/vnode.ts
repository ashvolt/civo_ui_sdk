/**
 * Markup as data: the shape templates return.
 *
 * Declared here as well as in `relax-ui-theme-base` because this package takes
 * no dependency. The two are the same structural type, and `CHILDREN` is a
 * registered symbol, so it is the same value in both packages and every copy.
 */

export const CHILDREN: unique symbol = Symbol.for("relax-ui.children") as never;

/**
 * `symbol` rather than `typeof CHILDREN`: each package's `unique symbol` is a
 * distinct type to TypeScript even though the value is shared. At runtime only
 * `CHILDREN` itself is treated as the slot; any other symbol is ignored.
 */
export type VChild = VNode | string | symbol;

export interface VNode {
  tag: string;
  attrs: Readonly<Record<string, string>>;
  children: readonly VChild[];
}

/** A component implementation the DOM backend can draw. */
export type Template = (props: never) => VNode;
