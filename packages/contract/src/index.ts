/**
 * relax-ui-contract — the component vocabulary of a generative UI.
 *
 * The twelve standard components, `defineContract` and `extend()` for an
 * application's own, and the schema builder both the server and the browser
 * use. Depends on `relax-ui-protocol`; Zod is a peer.
 */

export { defineContract } from "./contract.js";
export type { Contract } from "./contract.js";

export { buildUISchemas, DEFAULT_LIMITS } from "./schemas.js";
export type { ChildrenPolicy, ComponentSpec, ComponentSpecMap, UILimits, UISchemas } from "./schemas.js";

export { displayText, urlString } from "./fields.js";

export { STANDARD_COMPONENT_NAMES, STANDARD_COMPONENTS, standardContract } from "./standard.js";
export type { StandardComponentName, StandardProps } from "./standard.js";

export { createValidator } from "./validator.js";
export type { PropsValidator } from "./validator.js";
