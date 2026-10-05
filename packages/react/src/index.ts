"use client";

/**
 * relax-ui-react — React bindings for the relaxAI Generative UI SDK.
 *
 * Client-only, key-free and model-agnostic: this package consumes the SDK's
 * validated event stream. It never sees a relaxAI credential and never parses
 * model output.
 */

export { useGenerativeObject } from "./use-generative-object.js";
export type {
  GenerativeObjectState,
  UseGenerativeObjectOptions,
  UseGenerativeObjectResult,
} from "./use-generative-object.js";

export { createGenerativeRenderer, GenerativeUI } from "./renderer.js";
export type {
  ComponentImplementations,
  GenerativeComponent,
  GenerativeComponentProps,
  GenerativeUIProps,
  RenderFailure,
} from "./renderer.js";

export { readUIStream } from "./stream.js";
