/**
 * relax-ui-protocol — the browser half of the SDK's wire protocol.
 *
 * Everything a page needs to turn the SDK's event stream into a document, and
 * nothing else: no client, no model, no validation library, no dependency.
 * `relax-ui-core` re-exports all of it, so server code is unaffected.
 */

export type {
  CompletionUsage,
  GenerationMetadata,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  StructuringStrategyName,
} from "./types.js";

export { isRelaxUIError, RelaxUIError } from "./errors.js";
export type { RelaxUIErrorCode, RelaxUIErrorOptions } from "./errors.js";

export {
  applyPatch,
  decodePointerSegment,
  diffJson,
  encodePointerSegment,
  fromPointer,
  toPointer,
} from "./json-patch.js";
export type { JsonPatchOp } from "./json-patch.js";

export { decodeSSE, isStreamTerminator } from "./sse.js";
export type { SSEEvent } from "./sse.js";

export {
  encodeUIStreamEvent,
  isUIStreamEvent,
  UI_STREAM_PROTOCOL_VERSION,
  UIStreamAccumulator,
} from "./events.js";
export type {
  UIStreamCompleteEvent,
  UIStreamErrorEvent,
  UIStreamEvent,
  UIStreamMetaEvent,
  UIStreamPatchEvent,
  UIStreamSnapshotEvent,
} from "./events.js";

export { readUIStream } from "./read.js";

export { readSource, sourceKind } from "./sources.js";
export type { ReadSourceOptions, SocketLike, Source, SourceKind } from "./sources.js";

export { isSameOriginUrl, resolveValidation } from "./trust.js";
export type { ValidationTier } from "./trust.js";

export { measureTree } from "./ui.js";
export type { TreeBudget, UINode } from "./ui.js";

export { assertSafeUrl, DEFAULT_DATA_MEDIA_TYPES, DEFAULT_URL_SCHEMES, sanitizeUrl } from "./url.js";
export type { UrlPolicy } from "./url.js";
