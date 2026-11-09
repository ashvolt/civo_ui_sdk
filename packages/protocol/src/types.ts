/**
 * The types the wire protocol is written in.
 *
 * Moved here from `relax-ui-core` (which re-exports them) so that a browser can
 * describe a document and its metadata without installing the server half.
 * Nothing in this file has a runtime value.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/**
 * Which mechanism the SDK used to coerce the model into returning JSON that
 * matches the caller's schema. Surfaced to callers because it is the single
 * most useful signal when debugging a malformed generation.
 */
export type StructuringStrategyName = "native_json_schema" | "tool_call" | "prompted_json";

export interface CompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface GenerationMetadata {
  requestId: string;
  model: string;
  /**
   * Id of the inference provider that served the generation (`relaxai`,
   * `ollama`, ...). Optional only because a hand-written client may not say.
   */
  provider?: string;
  strategy: StructuringStrategyName;
  /** Strategies that were attempted and rejected before `strategy` succeeded. */
  downgradedFrom: StructuringStrategyName[];
  /** How many repair round-trips were spent before the object validated. */
  repairAttempts: number;
  usage?: CompletionUsage;
  /** Wall-clock milliseconds from first byte sent to final validated object. */
  durationMs: number;
}
