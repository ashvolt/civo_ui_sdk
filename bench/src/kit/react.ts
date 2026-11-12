import { createElement, type ReactElement, type ReactNode } from "react";
import { baseTemplates, CHILDREN, type VNode } from "relax-ui-theme-base";
import { kitTemplates } from "./templates.ts";

/**
 * The kit drawn by React (plan D2, T-430): every contender's React components
 * call this, so each draws the same elements, classes and text as the
 * reference. It turns markup as data into React elements and adds nothing:
 * no URL guard, no attribute filter. Whatever safety a page has is the
 * contender's own (spec FR-430).
 */

type AnyTemplate = (props: never) => VNode;

export const allTemplates: Record<string, AnyTemplate> = { ...baseTemplates, ...kitTemplates } as never;

function toReact(node: VNode, children: ReactNode): ReactElement {
  const props: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.attrs)) props[name === "class" ? "className" : name] = value;
  const kids = node.children.map((c) => (c === CHILDREN ? children : typeof c === "string" ? c : toReact(c, children)));
  return createElement(node.tag, props, ...kids);
}

/** Props as a contender hands them over, without the nulls some formats use for "absent". */
export function cleanProps(props: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props ?? {})) if (v !== null && v !== undefined && k !== "children") out[k] = v;
  return out;
}

/** Draws one kit component, its children placed where the template puts them. */
export function drawReact(type: string, props: Record<string, unknown> | undefined, children?: ReactNode): ReactElement | null {
  const template = allTemplates[type];
  return template ? toReact(template(cleanProps(props) as never), children) : null;
}
