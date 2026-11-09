/**
 * relax-ui-render — the framework-neutral render core and its DOM backend.
 *
 * The resolver decides, per node, what a document shows: contract types only,
 * validation by trust tier, code loaded on first use. The DOM backend draws
 * it, reconciling frame by frame on the protocol's structural sharing. React
 * uses the same resolver. No dependencies.
 */

export { createCatalog } from "./catalog.js";
export type { Catalog, CatalogOptions, CatalogState, Loader } from "./catalog.js";

export { Resolver } from "./resolver.js";
export type {
  RenderReason,
  RenderReport,
  Resolution,
  ResolverOptions,
  Validator,
  ValidatorSource,
} from "./resolver.js";

export { DomRenderer } from "./dom.js";
export type { DomRendererOptions, RenderOptions } from "./dom.js";

export { CHILDREN } from "./vnode.js";
export type { Template, VChild, VNode } from "./vnode.js";
