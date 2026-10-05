import type { CapabilityRegistry } from "../capability/registry.js";
import type { ProviderDescriptor, SchemaDialect } from "../provider/profile.js";
import type { ChatCompletionRequest, ChatCompletionResponse, ModelDescriptor } from "../types.js";

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * Everything the generation engine needs from an inference endpoint.
 *
 * `generateObject`, `streamObject` and the route adapter depend on this
 * interface and on nothing else about where completions come from. The SDK
 * ships one implementation ({@link OpenAICompatibleClient}); an application can
 * supply another — a different wire protocol, an in-process model, a
 * record-and-replay harness — without subclassing anything.
 *
 * It is an interface rather than a base class so that an implementation
 * inherits no transport, no retry policy and no key handling it did not ask
 * for.
 */
export interface InferenceClient {
  /** Which endpoint this is, and whether it is a sovereign one. */
  readonly provider: ProviderDescriptor;
  /** What is believed, and has been learned, about this endpoint's models. */
  readonly capabilities: CapabilityRegistry;
  /** Keywords this endpoint's constrained decoder cannot honour, if any. */
  readonly schemaDialect?: SchemaDialect;

  listModels(options?: RequestOptions): Promise<ModelDescriptor[]>;

  chatCompletion(
    request: ChatCompletionRequest,
    options?: RequestOptions,
  ): Promise<ChatCompletionResponse>;

  /** Yields decoded chunks in order. Ends when the upstream stream ends. */
  streamChatCompletion(
    request: ChatCompletionRequest,
    options?: RequestOptions,
  ): AsyncIterable<ChatCompletionResponse>;
}
