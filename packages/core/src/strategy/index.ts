import type { ModelCapabilities } from "../capability/registry.js";
import { RelaxUIError } from "../errors.js";
import type { StructuredSchema } from "../schema/define.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  JsonSchema,
  StructuringStrategyName,
} from "../types.js";

export interface SamplingParams {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  seed?: number;
  stop?: string | string[];
}

export interface StrategyContext<T> {
  model: string;
  schema: StructuredSchema<T>;
  messages: ChatMessage[];
  capabilities: ModelCapabilities;
  sampling?: SamplingParams;
  /**
   * The JSON Schema to put on the wire for server-enforced tiers, when the
   * endpoint's constrained decoder needs something narrower than the
   * application's own. Absent means "send `schema.jsonSchema` as it is".
   *
   * Never used by the prompted tier: that one is read by the model rather than
   * compiled by the server, so it gets the full description.
   */
  wireSchema?: JsonSchema;
}

/**
 * How the SDK asks a model for a specific shape.
 *
 * Three implementations, tried strongest-first. Each has the same job — get
 * JSON matching a schema — but a different contract with the server, so each
 * also has a different way of reading the answer back out.
 */
export interface StructuringStrategy {
  readonly name: StructuringStrategyName;
  buildRequest<T>(context: StrategyContext<T>): ChatCompletionRequest;
  /** JSON text delta carried by one streaming chunk. */
  deltaOf(chunk: ChatCompletionResponse): string;
  /** JSON text from a completed non-streaming response. */
  finalOf(response: ChatCompletionResponse): string;
  /**
   * Text a streaming chunk carries *outside* this strategy's own channel.
   *
   * Only the tool tier defines it. Some models answer a forced tool call by
   * writing the document as ordinary message content; reading it from there
   * costs nothing, where ignoring it costs a second generation.
   */
  fallbackDeltaOf?(chunk: ChatCompletionResponse): string;
}

function contentDelta(chunk: ChatCompletionResponse): string {
  return chunk.choices?.[0]?.delta?.content ?? "";
}

function contentFinal(response: ChatCompletionResponse): string {
  const choice = response.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  throw new RelaxUIError({
    code: "no_content",
    message: `The endpoint returned no assistant content (finish_reason=${choice?.finish_reason ?? "unknown"}).`,
  });
}

function withSampling(request: ChatCompletionRequest, sampling?: SamplingParams): ChatCompletionRequest {
  if (!sampling) return request;
  const out: ChatCompletionRequest = { ...request };
  if (sampling.temperature !== undefined) out.temperature = sampling.temperature;
  if (sampling.top_p !== undefined) out.top_p = sampling.top_p;
  if (sampling.max_tokens !== undefined) out.max_tokens = sampling.max_tokens;
  if (sampling.seed !== undefined) out.seed = sampling.seed;
  if (sampling.stop !== undefined) out.stop = sampling.stop;
  return out;
}

/**
 * Tier 1 — the server constrains decoding to the schema.
 *
 * When a model genuinely supports this it is the only tier that *cannot* produce
 * a shape violation, because invalid tokens are never sampled. Worth reaching
 * for first even though most of relaxAI's catalogue cannot do it yet.
 */
export const nativeJsonSchemaStrategy: StructuringStrategy = {
  name: "native_json_schema",
  buildRequest<T>(context: StrategyContext<T>): ChatCompletionRequest {
    return withSampling(
      {
        model: context.model,
        messages: context.messages,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: context.schema.name,
            schema: context.wireSchema ?? context.schema.jsonSchema,
            strict: true,
            ...(context.schema.description ? { description: context.schema.description } : {}),
          },
        },
      },
      context.sampling,
    );
  },
  deltaOf: contentDelta,
  finalOf: contentFinal,
};

/**
 * Tier 2 — the schema becomes a function signature.
 *
 * Tool calling is far more widely implemented than constrained decoding, and
 * models are heavily post-trained on it, so arguments come back as clean JSON
 * with no prose and no fences. For most of relaxAI's catalogue this is the
 * strategy that actually runs.
 */
export const toolCallStrategy: StructuringStrategy = {
  name: "tool_call",
  buildRequest<T>(context: StrategyContext<T>): ChatCompletionRequest {
    return withSampling(
      {
        model: context.model,
        messages: context.messages,
        tools: [
          {
            type: "function",
            function: {
              name: context.schema.name,
              description:
                context.schema.description ??
                `Emit the requested UI payload. Call this function exactly once.`,
              parameters: context.wireSchema ?? context.schema.jsonSchema,
              strict: true,
            },
          },
        ],
        // `required` rather than `auto`: we are not offering the model a choice,
        // we are using the tool channel as a typed return value.
        tool_choice: { type: "function", function: { name: context.schema.name } },
      },
      context.sampling,
    );
  },
  deltaOf(chunk: ChatCompletionResponse): string {
    const calls = chunk.choices?.[0]?.delta?.tool_calls;
    if (!calls || calls.length === 0) return "";
    // Only one tool is ever offered, so index 0 is the one we want; servers that
    // omit `index` still put it first.
    return calls[0]?.function?.arguments ?? "";
  },
  fallbackDeltaOf: contentDelta,
  finalOf(response: ChatCompletionResponse): string {
    const call = response.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      // Some servers answer a forced tool_choice with plain content anyway.
      const content = response.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim() !== "") return content;
      throw new RelaxUIError({
        code: "no_content",
        message: "Forced tool call produced neither tool_calls nor content.",
        strategy: "tool_call",
      });
    }
    return call.function.arguments;
  },
};

/**
 * Tier 3 — ask nicely, in the prompt, and verify afterwards.
 *
 * The floor. It works on literally any chat model, which is why it is the last
 * resort rather than no resort: combined with the repair loop it still reaches
 * a validated object, it just costs more tokens to get there.
 */
export const promptedJsonStrategy: StructuringStrategy = {
  name: "prompted_json",
  buildRequest<T>(context: StrategyContext<T>): ChatCompletionRequest {
    const instruction = buildSchemaInstruction(context.schema);
    const messages = injectSystemInstruction(context.messages, instruction);

    const request: ChatCompletionRequest = { model: context.model, messages };
    // `json_object` mode is much more widely supported than `json_schema` and
    // costs nothing to ask for: it at least guarantees parseable JSON.
    if (context.capabilities.jsonObject) request.response_format = { type: "json_object" };
    return withSampling(request, context.sampling);
  },
  deltaOf: contentDelta,
  finalOf: contentFinal,
};

const STRATEGIES: Record<StructuringStrategyName, StructuringStrategy> = {
  native_json_schema: nativeJsonSchemaStrategy,
  tool_call: toolCallStrategy,
  prompted_json: promptedJsonStrategy,
};

export function getStrategy(name: StructuringStrategyName): StructuringStrategy {
  return STRATEGIES[name];
}

/**
 * The prompt used by tier 3.
 *
 * Kept short on purpose. Long "you MUST" preambles crowd out the actual task
 * and, on smaller models, measurably increase the rate of the failure they were
 * meant to prevent.
 */
export function buildSchemaInstruction<T>(schema: StructuredSchema<T>): string {
  return [
    `Respond with a single JSON document and nothing else: no prose, no markdown fences, no commentary.`,
    schema.description ? `Purpose: ${schema.description}` : null,
    `The document must validate against this JSON Schema:`,
    JSON.stringify(schema.jsonSchema),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Appends to an existing leading system message, or prepends a new one. */
export function injectSystemInstruction(
  messages: readonly ChatMessage[],
  instruction: string,
): ChatMessage[] {
  const first = messages[0];
  if (first?.role === "system") {
    return [{ ...first, content: `${first.content}\n\n${instruction}` }, ...messages.slice(1)];
  }
  return [{ role: "system", content: instruction }, ...messages];
}
