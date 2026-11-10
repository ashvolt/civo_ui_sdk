/**
 * relax-ui-element — `<gen-ui>`, the standard Web Component.
 *
 * Renders a generated document from any source in any host: plain HTML,
 * Angular, Vue, a micro-frontend. Isolated in a shadow root by default; `light`
 * mode for theme libraries whose styles are global. No dependencies: the render
 * core, the base theme and the protocol are compiled in; the contract (and
 * Zod) load only when a document is validated in the browser.
 */

import { GenUIElement } from "./element.js";

export { GenUIElement } from "./element.js";
export type { ContractLike, GenUIMode, RenderState } from "./element.js";

export { defineConnector } from "relax-ui-render";
export type {
  ClassImplementation,
  ClassMapping,
  Connector,
  ConnectorOptions,
  ElementImplementation,
  Implementation,
  PropMapping,
  RenderReport,
  TemplateImplementation,
} from "relax-ui-render";
export type { Source } from "relax-ui-protocol";

/**
 * Registers the element, once. Safe to call from several bundles on one page:
 * a name already taken is left alone.
 */
export function defineGenUI(name = "gen-ui"): typeof GenUIElement {
  const registry = globalThis.customElements;
  const existing = registry?.get(name);
  if (existing) return existing as typeof GenUIElement;
  // A subclass per name: one class may back only one element name.
  const element = class extends GenUIElement {};
  registry?.define(name, element);
  return element;
}
