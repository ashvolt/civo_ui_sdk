"use client";

import { sanitizeUrl } from "relax-ui-protocol";
import {
  baseTemplates,
  CHILDREN,
  themeAttributes,
  type BaseComponentName,
  type Density,
  type Variant,
  type VNode,
} from "relax-ui-theme-base";
import * as React from "react";
import type { GenerativeComponent, GenerativeComponentProps } from "./renderer.js";

/**
 * React rendering of theme templates.
 *
 * The base theme writes each component once, as markup data. This turns that
 * data into React elements, so the React renderer and the phase-4 DOM renderer
 * draw the same markup from the same code.
 *
 * Nothing here can produce raw HTML: strings become text children, attributes
 * pass through an allowlist, and an `href` goes through the URL guard again.
 */

type Templates = Record<string, (props: never) => VNode>;

/** Turns a map of templates into components for `createGenerativeRenderer`. */
export function fromTemplates<T extends Templates>(templates: T): { [K in keyof T]: GenerativeComponent<never> } {
  const out = {} as { [K in keyof T]: GenerativeComponent<never> };
  for (const name of Object.keys(templates) as (keyof T & string)[]) {
    const template = templates[name]!;
    const Component = ({ props, children }: GenerativeComponentProps<never>) =>
      toReact(template(props as never), children);
    Component.displayName = `Gen${name}`;
    out[name] = Component as GenerativeComponent<never>;
  }
  return out;
}

/**
 * The twelve standard components, styled by the base theme's tokens.
 *
 * Marked pure so a bundler drops it, and the theme with it, from an
 * application that never imports it: the hook alone must not pay for a theme.
 */
export const baseComponents: Record<BaseComponentName, GenerativeComponent<never>> = /* @__PURE__ */ fromTemplates(baseTemplates);

export interface GenerativeThemeProps {
  /** `auto` follows the system setting. Default `light`. */
  variant?: Variant;
  density?: Density;
  className?: string;
  children?: React.ReactNode;
}

/**
 * The themed root. Changing `variant` or `density` changes two attributes on
 * this element and nothing else: components restyle without re-rendering
 * (FR-232). Needs `relax-ui-theme-base/theme.css` on the page.
 */
export function GenerativeTheme({ variant = "light", density = "comfortable", className, children }: GenerativeThemeProps) {
  const attrs = themeAttributes(variant, density);
  return (
    <div
      className={className ? `${attrs.class} ${className}` : attrs.class}
      data-gen-variant={attrs["data-gen-variant"]}
      data-gen-density={attrs["data-gen-density"]}
    >
      {children}
    </div>
  );
}

// Attribute names a template may set. Event handlers, `style`, and React's own
// escape hatches are refused by construction, whatever a template says.
const ATTRIBUTE = /^(?!on)[a-zA-Z][a-zA-Z0-9-]*$/i;
const REFUSED = new Set(["style", "dangerouslysetinnerhtml", "ref", "key", "srcdoc", "formaction"]);

function toReact(node: VNode, children: React.ReactNode): React.ReactElement {
  const props: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.attrs)) {
    if (!ATTRIBUTE.test(name) || REFUSED.has(name.toLowerCase())) continue;
    if (name === "class") {
      props.className = value;
    } else if (name === "href" || name === "src") {
      const safe = sanitizeUrl(value);
      if (safe !== null) props[name] = safe;
    } else {
      props[name] = value;
    }
  }
  const kids = node.children.map((child) =>
    child === CHILDREN ? children : typeof child === "string" ? child : toReact(child, children),
  );
  // Children passed as arguments, not an array: positions are fixed by the
  // template, so React needs no keys for them.
  return React.createElement(node.tag, props, ...kids);
}
