/**
 * relax-ui-core — Generative UI for Civo relaxAI.
 *
 * relaxAI is the default endpoint, not a requirement: the engine drives any
 * `InferenceClient`, and `createClient({ provider: "ollama" })` runs every code
 * path against an open-weight model on your own machine.
 *
 * Runtime-agnostic: Node, Bun, Deno, Cloudflare Workers, the Vercel Edge
 * runtime and a Next.js route handler all run this same build. The only
 * platform API it requires is `fetch`.
 */

export { RelaxUIError, isRelaxUIError } from "./errors.js";
export type { RelaxUIErrorCode, RelaxUIErrorOptions } from "./errors.js";

export type {
  ChatCompletionChoice,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ChatRole,
  CompletionUsage,
  GenerationMetadata,
  JsonObject,
  JsonPrimitive,
  JsonSchema,
  JsonValue,
  ModelDescriptor,
  ResponseFormat,
  StructuringStrategyName,
  ToolCall,
  ToolDefinition,
} from "./types.js";
export { STRATEGY_PRECEDENCE } from "./types.js";

// --- providers ------------------------------------------------------------
export {
  BUILT_IN_PROVIDERS,
  defineProvider,
  describeProvider,
  llamacpp,
  lmstudio,
  LOOPBACK_ONLY_POLICY,
  ollama,
  relaxai,
  resolveProvider,
} from "./provider/profile.js";
export type { ProviderDescriptor, ProviderProfile, SchemaDialect } from "./provider/profile.js";
export {
  discoverChatModel,
  parseParamCount,
  pickChatModel,
  rankChatModels,
} from "./provider/model-selection.js";

// --- client ---------------------------------------------------------------
export type { InferenceClient, RequestOptions } from "./client/inference-client.js";
export { contentDeltaOf, createClient, OpenAICompatibleClient } from "./client/openai-compatible-client.js";
export type { OpenAICompatibleClientOptions } from "./client/openai-compatible-client.js";
export { RelaxClient } from "./client/relax-client.js";
export type { RelaxClientOptions } from "./client/relax-client.js";
export { HttpClient } from "./client/http.js";
export type { AttemptInfo, FetchLike, HttpClientOptions, HttpRequest, RetryPolicy } from "./client/http.js";

// --- guards ---------------------------------------------------------------
export { assertSovereignEndpoint, DEFAULT_ALLOWED_HOSTS } from "./guard/sovereignty.js";
export type { SovereigntyPolicy } from "./guard/sovereignty.js";
export { DEFAULT_REDACTION_RULES, redact } from "./guard/redaction.js";
export type { RedactionReport, RedactionRule } from "./guard/redaction.js";
export { assertSafeUrl, DEFAULT_DATA_MEDIA_TYPES, DEFAULT_URL_SCHEMES, sanitizeUrl } from "./guard/url.js";
export type { UrlPolicy } from "./guard/url.js";

// --- capability -----------------------------------------------------------
export {
  CapabilityRegistry,
  capabilityRegistryFor,
  defaultCapabilityRegistry,
  UNKNOWN_MODEL_CAPABILITIES,
} from "./capability/registry.js";
export type { CapabilityRegistryOptions, ModelCapabilities } from "./capability/registry.js";
export { isCapabilityRejection, negotiateStrategy } from "./capability/negotiate.js";
export type { NegotiationInput, NegotiationResult } from "./capability/negotiate.js";

// --- schema ---------------------------------------------------------------
export { defineStructuredSchema } from "./schema/define.js";
export type { DefineStructuredSchemaOptions, StructuredSchema } from "./schema/define.js";
export { adaptJsonSchema } from "./schema/dialect.js";
export type { AdaptedSchema } from "./schema/dialect.js";
export { toJsonSchema } from "./schema/json-schema.js";
export type { ToJsonSchemaOptions } from "./schema/json-schema.js";
export { classifyIssue, formatIssues, redactIssues, safeParsePartial } from "./schema/partial.js";
export type {
  PartialValidationResult,
  SchemaLike,
  ZodIssueLike,
  ZodSafeParseLike,
} from "./schema/partial.js";

// --- streaming primitives -------------------------------------------------
export { decodeSSE, isStreamTerminator } from "./stream/sse.js";
export type { SSEEvent } from "./stream/sse.js";
export { completePartialJson, parsePartialJson } from "./stream/partial-json.js";
export type { PartialParseResult, PartialParseState } from "./stream/partial-json.js";
export {
  applyPatch,
  diffJson,
  decodePointerSegment,
  encodePointerSegment,
  fromPointer,
  toPointer,
} from "./stream/json-patch.js";
export type { JsonPatchOp } from "./stream/json-patch.js";

// --- strategies -----------------------------------------------------------
export {
  buildSchemaInstruction,
  getStrategy,
  injectSystemInstruction,
  nativeJsonSchemaStrategy,
  promptedJsonStrategy,
  toolCallStrategy,
} from "./strategy/index.js";
export type { SamplingParams, StrategyContext, StructuringStrategy } from "./strategy/index.js";
export { extractJsonText, JsonTextAccumulator, stripCodeFences, stripReasoning } from "./strategy/extract.js";
export type { ExtractOptions } from "./strategy/extract.js";

// --- generation -----------------------------------------------------------
export { generateObject, streamObject, toSSEStream } from "./generate.js";
export type {
  GenerateObjectOptions,
  GenerateObjectResult,
  GenerationTrace,
  StreamObjectOptions,
} from "./generate.js";

// --- protocol -------------------------------------------------------------
export {
  encodeUIStreamEvent,
  isUIStreamEvent,
  UI_STREAM_PROTOCOL_VERSION,
  UIStreamAccumulator,
} from "./protocol.js";
export type {
  UIStreamCompleteEvent,
  UIStreamErrorEvent,
  UIStreamEvent,
  UIStreamMetaEvent,
  UIStreamPatchEvent,
  UIStreamSnapshotEvent,
} from "./protocol.js";

// --- generative UI contract ----------------------------------------------
export { createUIRegistry, displayText, measureTree, urlString } from "./ui/contract.js";
export type {
  ChildrenPolicy,
  ComponentSpec,
  ComponentSpecMap,
  TreeBudget,
  UINode,
  UIRegistry,
  UIRegistryOptions,
} from "./ui/contract.js";

// --- observability --------------------------------------------------------
export { emptyMetrics, MetricsCollector } from "./observability/metrics.js";
export type { GenerationMetrics } from "./observability/metrics.js";
