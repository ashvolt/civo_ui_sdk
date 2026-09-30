import { isCapabilityRejection, negotiateStrategy } from "./capability/negotiate.js";
import type { ModelCapabilities } from "./capability/registry.js";
import type { RelaxClient, RequestOptions } from "./client/relax-client.js";
import { RelaxUIError } from "./errors.js";
import {
  encodeUIStreamEvent,
  UI_STREAM_PROTOCOL_VERSION,
  type UIStreamEvent,
} from "./protocol.js";
import type { StructuredSchema } from "./schema/define.js";
import { formatIssues, redactIssues, safeParsePartial, type ZodIssueLike } from "./schema/partial.js";
import { diffJson, type JsonPatchOp } from "./stream/json-patch.js";
import { parsePartialJson } from "./stream/partial-json.js";
import { JsonTextAccumulator } from "./strategy/extract.js";
import { getStrategy, type SamplingParams, type StructuringStrategy } from "./strategy/index.js";
import type {
  ChatCompletionResponse,
  ChatMessage,
  CompletionUsage,
  GenerationMetadata,
  JsonValue,
  StructuringStrategyName,
} from "./types.js";

export interface GenerateObjectOptions<T> extends RequestOptions {
  client: RelaxClient;
  model: string;
  schema: StructuredSchema<T>;
  messages?: ChatMessage[];
  /** Convenience for a single user turn. Ignored when `messages` is given. */
  prompt?: string;
  system?: string;
  sampling?: SamplingParams;
  /** Restrict the strategy ladder, e.g. to forbid `prompted_json`. */
  allowStrategies?: readonly StructuringStrategyName[];
  /** Skip negotiation entirely. */
  forceStrategy?: StructuringStrategyName;
  /**
   * Re-ask rounds allowed after a schema violation. Default 1.
   *
   * One is the considered default: a second re-ask rarely succeeds where the
   * first failed, and both cost a full generation. Raise it if you would rather
   * spend tokens than show an error.
   */
  maxRepairAttempts?: number;
  /** Observability hook. Receives no prompt or completion text. */
  onEvent?: (event: GenerationTrace) => void;
}

export type GenerationTrace =
  | { type: "strategy_selected"; strategy: StructuringStrategyName; fallbacks: StructuringStrategyName[] }
  | { type: "strategy_downgraded"; from: StructuringStrategyName; to: StructuringStrategyName; reason: string }
  | { type: "repair_attempt"; attempt: number; issues: JsonValue }
  | { type: "validated"; strategy: StructuringStrategyName; repairAttempts: number };

export interface GenerateObjectResult<T> {
  object: T;
  metadata: GenerationMetadata;
}

export interface StreamObjectOptions<T> extends GenerateObjectOptions<T> {
  /**
   * Minimum ms between emitted frames. 0 emits on every token, which is right
   * for text that renders as it arrives and wasteful for a component tree that
   * repaints. Default 0; 40-60 is a good setting for dense UI.
   */
  frameIntervalMs?: number;
  /** Emit full snapshots instead of patches. Larger, but trivial to debug. */
  transport?: "patch" | "snapshot";
  /** Injected in tests so throttling is deterministic. */
  now?: () => number;
}

interface Attempt<T> {
  strategy: StructuringStrategy;
  messages: ChatMessage[];
  capabilities: ModelCapabilities;
  schema: StructuredSchema<T>;
}

/**
 * Generates one schema-valid object.
 *
 * The whole point of the SDK in one function: negotiate the strongest available
 * structuring strategy, downgrade if the server disagrees, extract JSON out of
 * whatever wrapper the model used, validate against the caller's Zod schema, and
 * re-ask with the validation errors if it still does not fit. The caller gets a
 * typed object or a typed error, never a "probably fine" string.
 */
export async function generateObject<T>(
  options: GenerateObjectOptions<T>,
): Promise<GenerateObjectResult<T>> {
  const started = nowMs();
  const requestId = newRequestId();
  const baseMessages = buildMessages(options);
  const maxRepairs = options.maxRepairAttempts ?? 1;

  const negotiation = negotiateStrategy({
    model: options.model,
    registry: options.client.capabilities,
    ...(options.allowStrategies ? { allow: options.allowStrategies } : {}),
    ...(options.forceStrategy ? { force: options.forceStrategy } : {}),
  });
  options.onEvent?.({
    type: "strategy_selected",
    strategy: negotiation.strategy,
    fallbacks: negotiation.fallbacks,
  });

  const ladder = [negotiation.strategy, ...negotiation.fallbacks];
  const downgradedFrom: StructuringStrategyName[] = [];
  let usage: CompletionUsage | undefined;
  let lastFailure: RelaxUIError | undefined;

  for (let tier = 0; tier < ladder.length; tier++) {
    const strategyName = ladder[tier] as StructuringStrategyName;
    const strategy = getStrategy(strategyName);
    let messages = baseMessages;

    try {
      for (let repair = 0; repair <= maxRepairs; repair++) {
        const request = strategy.buildRequest<T>({
          model: options.model,
          schema: options.schema,
          messages,
          capabilities: negotiation.capabilities,
          ...(options.sampling ? { sampling: options.sampling } : {}),
        });

        const response = await options.client.chatCompletion(request, requestOptions(options));
        usage = response.usage ?? usage;
        // A model that ran out of budget will run out again on the identical
        // re-ask, so a repair round here buys a second truncated document at
        // full price. Say what actually happened instead.
        const stoppedAtLimit = response.choices[0]?.finish_reason === "length";

        const rawText = strategy.finalOf(response);
        const accumulator = new JsonTextAccumulator({
          stripReasoning: negotiation.capabilities.reasoningTrace,
        });
        accumulator.push(rawText);
        const jsonText = accumulator.jsonText();

        const parsed = parsePartialJson(jsonText);
        if (parsed.state === "invalid" || parsed.state === "empty") {
          if (stoppedAtLimit) {
            lastFailure = truncationError(options.schema.name, strategyName, requestId);
            break;
          }
          lastFailure = new RelaxUIError({
            code: "schema_violation",
            message: "Model response contained no parseable JSON document.",
            strategy: strategyName,
            requestId,
          });
        } else {
          const validation = safeParsePartial(options.schema.schema, parsed.value, true);
          if (validation.status === "ok") {
            options.onEvent?.({ type: "validated", strategy: strategyName, repairAttempts: repair });
            return {
              object: validation.data as T,
              metadata: {
                requestId,
                model: options.model,
                strategy: strategyName,
                downgradedFrom,
                repairAttempts: repair,
                durationMs: nowMs() - started,
                ...(usage ? { usage } : {}),
              },
            };
          }
          if (stoppedAtLimit) {
            lastFailure = truncationError(options.schema.name, strategyName, requestId);
            break;
          }
          lastFailure = new RelaxUIError({
            code: "schema_violation",
            message: `Generated object failed schema "${options.schema.name}".`,
            strategy: strategyName,
            requestId,
            details: redactIssues(validation.fatalIssues),
          });
          if (repair < maxRepairs) {
            options.onEvent?.({
              type: "repair_attempt",
              attempt: repair + 1,
              issues: redactIssues(validation.fatalIssues),
            });
            messages = appendRepairTurn(baseMessages, rawText, validation.fatalIssues);
            continue;
          }
        }

        if (repair >= maxRepairs) break;
        // No parseable JSON at all: re-ask with an explicit, minimal correction.
        messages = appendRepairTurn(baseMessages, rawText, []);
      }
    } catch (error) {
      if (isCapabilityRejection(error, strategyName) && tier + 1 < ladder.length) {
        const next = ladder[tier + 1] as StructuringStrategyName;
        options.client.capabilities.markStrategyUnsupported(options.model, strategyName);
        downgradedFrom.push(strategyName);
        options.onEvent?.({
          type: "strategy_downgraded",
          from: strategyName,
          to: next,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      throw error;
    }

    // Exhausted repairs on this tier. Only a *capability* problem justifies
    // dropping a tier; a model that can call tools but writes bad arguments will
    // not do better with a weaker mechanism.
    break;
  }

  throw (
    lastFailure ??
    new RelaxUIError({
      code: "unrepairable",
      message: `Could not obtain a valid "${options.schema.name}" object.`,
      requestId,
    })
  );
}

/**
 * Streams an object as it is generated, as protocol events.
 *
 * Fails fast: a *fatal* validation issue mid-stream (wrong type, unknown key)
 * ends the stream immediately instead of spending the rest of the generation on
 * output that cannot be rendered. Issues that merely mean "not written yet" are
 * expected and ignored until the stream closes.
 */
export async function* streamObject<T>(
  options: StreamObjectOptions<T>,
): AsyncGenerator<UIStreamEvent<T>, void, unknown> {
  const started = nowMs();
  const clock = options.now ?? nowMs;
  const requestId = newRequestId();
  const baseMessages = buildMessages(options);
  const frameInterval = options.frameIntervalMs ?? 0;
  const transport = options.transport ?? "patch";

  const negotiation = negotiateStrategy({
    model: options.model,
    registry: options.client.capabilities,
    ...(options.allowStrategies ? { allow: options.allowStrategies } : {}),
    ...(options.forceStrategy ? { force: options.forceStrategy } : {}),
  });

  if (!negotiation.capabilities.streaming) {
    // Honest degradation beats a broken stream: run the batch path and emit the
    // result as a single snapshot so the client code path is unchanged.
    const result = await generateObject(options);
    yield metaEvent(requestId, options, negotiation.strategy);
    yield { type: "snapshot", seq: 1, value: result.object as unknown as JsonValue };
    yield { type: "complete", value: result.object, metadata: result.metadata };
    return;
  }

  const ladder = [negotiation.strategy, ...negotiation.fallbacks];
  const downgradedFrom: StructuringStrategyName[] = [];

  for (let tier = 0; tier < ladder.length; tier++) {
    const strategyName = ladder[tier] as StructuringStrategyName;
    const strategy = getStrategy(strategyName);
    const attempt: Attempt<T> = {
      strategy,
      messages: baseMessages,
      capabilities: negotiation.capabilities,
      schema: options.schema,
    };

    let opened = false;
    try {
      const request = strategy.buildRequest<T>({
        model: options.model,
        schema: attempt.schema,
        messages: attempt.messages,
        capabilities: attempt.capabilities,
        ...(options.sampling ? { sampling: options.sampling } : {}),
      });

      const chunks = options.client.streamChatCompletion(request, requestOptions(options));
      const accumulator = new JsonTextAccumulator({
        stripReasoning: attempt.capabilities.reasoningTrace,
      });

      let seq = 0;
      let emitted: JsonValue | undefined;
      let lastFrameAt = -Infinity;
      let usage: CompletionUsage | undefined;
      let finishReason: string | null = null;

      for await (const chunk of chunks) {
        if (!opened) {
          opened = true;
          yield metaEvent(requestId, options, strategyName);
        }
        usage = chunk.usage ?? usage;
        finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
        accumulator.push(strategy.deltaOf(chunk));

        const now = clock();
        if (now - lastFrameAt < frameInterval) continue;

        const frame = buildFrame(accumulator, attempt, emitted, transport, ++seq);
        if (frame === "noop") {
          seq--;
          continue;
        }
        if (frame.kind === "fatal") {
          throw new RelaxUIError({
            code: "schema_violation",
            message: `Streamed object violates schema "${attempt.schema.name}" and cannot recover.`,
            strategy: strategyName,
            requestId,
            details: redactIssues(frame.issues),
          });
        }
        emitted = frame.value;
        lastFrameAt = now;
        yield frame.event;
      }

      if (!opened) {
        opened = true;
        yield metaEvent(requestId, options, strategyName);
      }

      // Flush anything the throttle held back, then validate for real.
      const finalText = accumulator.jsonText();
      const finalParse = parsePartialJson(finalText);
      const finalValue = finalParse.value;
      const validation =
        finalValue === undefined
          ? null
          : safeParsePartial(attempt.schema.schema, finalValue, true);

      if (validation?.status === "ok") {
        if (!deepEqual(emitted, finalValue)) {
          yield emitFrame(transport, ++seq, emitted, finalValue as JsonValue);
        }
        yield {
          type: "complete",
          value: validation.data as T,
          metadata: {
            requestId,
            model: options.model,
            strategy: strategyName,
            downgradedFrom,
            repairAttempts: 0,
            durationMs: nowMs() - started,
            ...(usage ? { usage } : {}),
          },
        };
        return;
      }

      // Ran out of tokens rather than out of things to say. The off-stream
      // repair below would send the identical request with the identical
      // budget and truncate at the identical place, so it is a full generation
      // spent to arrive back here — and it would report the symptom (a document
      // that fails the schema) rather than the cause.
      if (finishReason === "length") {
        throw truncationError(attempt.schema.name, strategyName, requestId);
      }

      // The stream ended short or wrong. Repair off-stream, then replace the
      // document wholesale — patching a repaired object against a broken one is
      // not meaningful.
      const repaired = await generateObject({
        ...options,
        forceStrategy: strategyName,
        maxRepairAttempts: options.maxRepairAttempts ?? 1,
      });
      yield { type: "snapshot", seq: ++seq, value: repaired.object as unknown as JsonValue };
      yield {
        type: "complete",
        value: repaired.object,
        metadata: { ...repaired.metadata, requestId, downgradedFrom, durationMs: nowMs() - started },
      };
      return;
    } catch (error) {
      // Downgrading is only safe before the first frame: the client has already
      // started rendering otherwise, and a different strategy restarts the
      // document from scratch.
      if (!opened && isCapabilityRejection(error, strategyName) && tier + 1 < ladder.length) {
        options.client.capabilities.markStrategyUnsupported(options.model, strategyName);
        downgradedFrom.push(strategyName);
        continue;
      }
      yield errorEvent(error, requestId);
      return;
    }
  }

  yield errorEvent(
    new RelaxUIError({
      code: "unrepairable",
      message: `No strategy produced a valid "${options.schema.name}" object.`,
      requestId,
    }),
    requestId,
  );
}

/** Adapts {@link streamObject} into an HTTP-ready SSE `ReadableStream`. */
export function toSSEStream<T>(
  events: AsyncGenerator<UIStreamEvent<T>, void, unknown>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await events.next();
        if (done) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(encodeUIStreamEvent(value)));
      } catch (error) {
        // The generator already converts failures into `error` frames; anything
        // reaching here is a bug in the SDK, so surface it rather than hang.
        controller.enqueue(
          encoder.encode(
            encodeUIStreamEvent({
              type: "error",
              error: {
                code: "transport_error",
                message: error instanceof Error ? error.message : String(error),
                retryable: false,
              },
            }),
          ),
        );
        controller.close();
      }
    },
    cancel() {
      void events.return(undefined);
    },
  });
}

// --- internals --------------------------------------------------------------

type Frame =
  | "noop"
  | { kind: "ok"; event: UIStreamEvent<never>; value: JsonValue }
  | { kind: "fatal"; issues: ZodIssueLike[] };

function buildFrame<T>(
  accumulator: JsonTextAccumulator,
  attempt: Attempt<T>,
  emitted: JsonValue | undefined,
  transport: "patch" | "snapshot",
  seq: number,
): Frame {
  const text = accumulator.jsonText();
  if (text === "") return "noop";

  const parsed = parsePartialJson(text);
  if (parsed.state === "invalid" || parsed.state === "empty" || parsed.value === undefined) {
    return "noop";
  }
  if (deepEqual(parsed.value, emitted)) return "noop";

  const validation = safeParsePartial(attempt.schema.schema, parsed.value, false);
  if (validation.status === "invalid") return { kind: "fatal", issues: validation.fatalIssues };

  return { kind: "ok", event: emitFrame(transport, seq, emitted, parsed.value), value: parsed.value };
}

function emitFrame(
  transport: "patch" | "snapshot",
  seq: number,
  previous: JsonValue | undefined,
  next: JsonValue,
): UIStreamEvent<never> {
  if (transport === "snapshot") return { type: "snapshot", seq, value: next };

  const ops: JsonPatchOp[] = diffJson(previous, next);
  // A patch bigger than the document is a false economy.
  if (JSON.stringify(ops).length >= JSON.stringify(next).length) {
    return { type: "snapshot", seq, value: next };
  }
  return { type: "patch", seq, ops };
}

function metaEvent<T>(
  requestId: string,
  options: GenerateObjectOptions<T>,
  strategy: StructuringStrategyName,
): UIStreamEvent<never> {
  return {
    type: "meta",
    protocol: UI_STREAM_PROTOCOL_VERSION,
    requestId,
    model: options.model,
    schema: options.schema.name,
    strategy,
  };
}

/**
 * The model hit its token ceiling mid-document.
 *
 * Distinct from `schema_violation` because the remedy is different and the
 * caller can act on it without reading the model's output: raise the budget, or
 * ask for less. Conflating the two sends people looking for a bug in a schema
 * that was never the problem — which is precisely what happens when a small
 * local model meets a large component registry.
 */
function truncationError(
  schemaName: string,
  strategy: StructuringStrategyName,
  requestId: string,
): RelaxUIError {
  return new RelaxUIError({
    code: "truncated",
    message:
      `The model stopped at its token limit before finishing a valid "${schemaName}" ` +
      `document (finish_reason=length). Raise sampling.max_tokens, or ask for a smaller document.`,
    // Retrying the same request unchanged truncates again; the caller has to
    // change something first.
    retryable: false,
    strategy,
    requestId,
  });
}

function errorEvent(error: unknown, requestId: string): UIStreamEvent<never> {
  if (error instanceof RelaxUIError) {
    return {
      type: "error",
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        requestId: error.requestId ?? requestId,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
  }
  return {
    type: "error",
    error: {
      code: "transport_error",
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
      requestId,
    },
  };
}

function buildMessages<T>(options: GenerateObjectOptions<T>): ChatMessage[] {
  if (options.messages && options.messages.length > 0) {
    return options.system
      ? [{ role: "system", content: options.system }, ...options.messages]
      : options.messages;
  }
  if (!options.prompt) {
    throw new RelaxUIError({
      code: "config_invalid",
      message: "Provide either `messages` or `prompt`.",
    });
  }
  const messages: ChatMessage[] = [];
  if (options.system) messages.push({ role: "system", content: options.system });
  messages.push({ role: "user", content: options.prompt });
  return messages;
}

/**
 * Builds the repair turn: the model's own output, then the specific failures.
 *
 * Echoing the bad output back matters — a model asked to "fix it" without being
 * shown what it wrote tends to regenerate from scratch and reproduce the fault.
 */
function appendRepairTurn(
  base: readonly ChatMessage[],
  previousOutput: string,
  issues: readonly ZodIssueLike[],
): ChatMessage[] {
  const complaint =
    issues.length > 0
      ? `That response did not match the required schema:\n${formatIssues(issues)}`
      : `That response did not contain a single parseable JSON document.`;

  return [
    ...base,
    { role: "assistant", content: truncate(previousOutput, 8_000) },
    {
      role: "user",
      content: `${complaint}\n\nReturn the corrected JSON document only. No prose, no markdown fences.`,
    },
  ];
}

function requestOptions<T>(options: GenerateObjectOptions<T>): RequestOptions {
  const out: RequestOptions = {};
  if (options.signal) out.signal = options.signal;
  if (options.timeoutMs !== undefined) out.timeoutMs = options.timeoutMs;
  if (options.headers) out.headers = options.headers;
  return out;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n...[truncated]`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function newRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `req_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export type { ChatCompletionResponse };
