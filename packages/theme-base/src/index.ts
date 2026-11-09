/**
 * relax-ui-theme-base — the base theme: design tokens, light/dark/compact
 * variants, and the twelve standard components as markup templates.
 *
 * No dependencies. Templates return markup as data (`VNode`), which each
 * renderer turns into its own output, so one implementation serves React now
 * and the DOM backend later.
 */

export { CHILDREN, h, SVG_TAGS } from "./vnode.js";
export type { VChild, VNode } from "./vnode.js";

export { baseTemplates, describeChart } from "./templates.js";
export { baseLoaders } from "./loaders.js";
export type { BaseComponentName, BaseProps, BaseTemplates, Template } from "./templates.js";

export { components, DENSITIES, themeAttributes, themeCss, tokens, VARIANTS } from "./css.js";
export type { Density, Variant } from "./css.js";
