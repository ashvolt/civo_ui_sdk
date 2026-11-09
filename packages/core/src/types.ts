/**
 * Shared, dependency-free types for the relaxAI Generative UI SDK.
 *
 * Nothing in this file imports `zod` or any runtime: the wire-level contract of
 * the SDK has to be describable (and assertable) without pulling a validation
 * library into environments that only consume the protocol.
 */

import type { CompletionUsage, JsonObject, StructuringStrategyName } from "relax-ui-protocol";

// The wire-level types moved to `relax-ui-protocol`, so a browser can use them
// without the server half. Re-exported so every existing import keeps working.
export type {
  CompletionUsage,
  GenerationMetadata,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  StructuringStrategyName,
} from "relax-ui-protocol";

/** A JSON Schema fragment. Deliberately loose: we emit a subset, we accept any. */
export type JsonSchema = JsonObject;

/** Roles accepted by the relaxAI `/chat/completions` endpoint (OpenAI-compatible). */
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on assistant messages that requested tools. */
  tool_calls?: ToolCall[];
  /** Required on `role: "tool"` messages, echoing the id being answered. */
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: JsonSchema;
    /** OpenAI's strict-mode flag. Ignored by servers that do not implement it. */
    strict?: boolean;
  };
}

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: { name: string; schema: JsonSchema; strict?: boolean; description?: string };
    };

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  seed?: number;
  stop?: string | string[];
  response_format?: ResponseFormat;
  tools?: ToolDefinition[];
  tool_choice?: "none" | "auto" | "required" | { type: "function"; function: { name: string } };
  [passthrough: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  finish_reason: string | null;
  message?: { role: string; content: string | null; tool_calls?: ToolCall[] };
  delta?: { role?: string; content?: string | null; tool_calls?: StreamedToolCall[] };
}

export interface StreamedToolCall {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: CompletionUsage;
}

export interface ModelDescriptor {
  id: string;
  object?: string;
  owned_by?: string;
  created?: number;
  [extra: string]: unknown;
}

/** Ordered from strongest guarantee to weakest. */
export const STRATEGY_PRECEDENCE: readonly StructuringStrategyName[] = [
  "native_json_schema",
  "tool_call",
  "prompted_json",
] as const;
