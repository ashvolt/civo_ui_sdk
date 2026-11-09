import {
  redactIssues,
  RelaxUIError,
  safeParsePartial,
  type GenerationMetadata,
  type SchemaLike,
  type StructuringStrategyName,
} from "relax-ui-core";
import {
  isSameOriginUrl,
  readSource,
  resolveValidation,
  sourceKind,
  UIStreamAccumulator,
  type Source,
  type SourceKind,
  type UIStreamEvent,
  type ValidationTier,
} from "relax-ui-protocol";

/**
 * One generation, from source to state, with no React in it.
 *
 * `useGenerativeObject` is a thin wrapper around this, so every rule here —
 * which sources may skip validation, when a frame is refused, how each kind of
 * source ends — is testable without a DOM, and reusable by a non-React host.
 */

export interface GenerationOptions<T> {
  /**
   * Route that returns the SDK's SSE event stream. Usually a Next.js handler.
   *
   * The original way to name a source, kept unchanged: a same-origin `api` is
   * trusted as the SDK's own route unless `validate: "full"` is passed. Use
   * `source` for anything else.
   */
  api?: string;
  /**
   * Where the document comes from: `{ url }`, `{ stream }`, `{ socket }` or
   * `{ document }`. Takes precedence over `api`.
   */
  source?: Source<T>;
  /**
   * How much the browser validates. `"full"` (the default for `source`) checks
   * every frame against `schema` before it reaches state. `"server"` trusts the
   * server's validation, and is refused for anything but a same-origin URL.
   */
  validate?: ValidationTier;
  /**
   * The schema the document must satisfy. Required whenever validation is
   * `"full"`; with `"server"` it re-checks the completed object only, as
   * defence in depth for the case where the endpoint is not the one you think.
   */
  schema?: SchemaLike<T>;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  onComplete?: (value: T, metadata: GenerationMetadata) => void;
  onError?: (error: RelaxUIError) => void;
  /**
   * Called with every frame, in order, before it is applied to state.
   *
   * An observer, not a hook into the pipeline: nothing returned from here
   * changes what renders.
   */
  onFrame?: (event: UIStreamEvent<T>) => void;
}

export interface GenerativeObjectState<T> {
  /** The document as of the latest frame. Partial while streaming. */
  object: Partial<T> | undefined;
  /** Set only once the object has passed the full schema. */
  value: T | undefined;
  isStreaming: boolean;
  error: RelaxUIError | undefined;
  /** Undefined for a `document` source: nothing was generated. */
  metadata: GenerationMetadata | undefined;
  /** Which structuring strategy the server ended up using. */
  strategy: StructuringStrategyName | undefined;
  /**
   * Id of the inference provider serving the generation, from the opening
   * frame. Undefined until then, and for servers that do not report one.
   */
  provider: string | undefined;
}

export const INITIAL_STATE: GenerativeObjectState<never> = {
  object: undefined,
  value: undefined,
  isStreaming: false,
  error: undefined,
  metadata: undefined,
  strategy: undefined,
  provider: undefined,
};

export interface GenerationPlan<T> {
  source: Source<T>;
  kind: SourceKind;
  tier: ValidationTier;
  schema: SchemaLike<T> | undefined;
}

/**
 * Decides source and validation tier, or refuses the configuration.
 *
 * Throws `config_invalid` before any request is made, so a refused
 * configuration never fetches, never listens and never renders.
 *
 * @param pageOrigin the page's origin; `location.origin` when omitted.
 */
export function planGeneration<T>(options: GenerationOptions<T>, pageOrigin?: string): GenerationPlan<T> {
  let source: Source<T>;
  let tier: ValidationTier;
  if (options.source !== undefined) {
    source = options.source;
    tier = resolveValidation(source as Source, options.validate, pageOrigin);
  } else if (typeof options.api === "string" && options.api !== "") {
    source = { url: options.api };
    // Features 001 and 002 behaviour (NFR-206): `api` names the SDK's own
    // route, so a same-origin one is trusted as before. A cross-origin one is
    // foreign, and Constitution IV requires validating it here.
    tier =
      options.validate === undefined
        ? isSameOriginUrl(options.api, pageOrigin)
          ? "server"
          : "full"
        : resolveValidation(source as Source, options.validate, pageOrigin);
  } else {
    throw new RelaxUIError({
      code: "config_invalid",
      message: "useGenerativeObject needs a `source` (or the `api` route) to read from.",
    });
  }

  const kind = sourceKind(source as Source);
  if (tier === "full" && !options.schema) {
    throw new RelaxUIError({
      code: "config_invalid",
      message:
        `A ${kind === "url" ? "cross-origin URL" : kind} source is validated in full in the browser, ` +
        "which needs `schema`. Pass the schema the document must satisfy.",
    });
  }
  return { source, kind, tier, schema: options.schema };
}

/**
 * Runs one generation, reporting every state change through `update`.
 *
 * Never throws: every failure, including a refused configuration, arrives as
 * `error` in state and through `onError`. A stop (`signal` aborted) is not a
 * failure and ends quietly.
 */
export async function runGeneration<T>(
  options: GenerationOptions<T>,
  body: unknown,
  signal: AbortSignal,
  update: (patch: Partial<GenerativeObjectState<T>>) => void,
): Promise<void> {
  const fail = (error: RelaxUIError) => {
    update({ isStreaming: false, error });
    options.onError?.(error);
  };

  let plan: GenerationPlan<T>;
  try {
    plan = planGeneration(options);
  } catch (cause) {
    fail(asRelaxUIError(cause));
    return;
  }

  const accumulator = new UIStreamAccumulator<T>();
  const full = plan.tier === "full";

  try {
    const events = readSource<T>(plan.source, {
      signal,
      body,
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.credentials ? { credentials: options.credentials } : {}),
    });

    for await (const event of events) {
      options.onFrame?.(event);
      accumulator.apply(event);

      switch (event.type) {
        case "meta":
          update({ strategy: event.strategy, provider: event.provider });
          break;

        case "patch":
        case "snapshot": {
          const current = accumulator.current();
          // Full validation happens before the frame reaches state, so an
          // invalid node is never rendered, not even for one frame (FR-206).
          // A document source is complete as delivered: check it as finished.
          if (full) check(plan.schema!, current, plan.kind === "document");
          update({ object: current as Partial<T> | undefined });
          break;
        }

        case "complete": {
          const value = finalValue(plan, event.value);
          if (value === REFUSED) {
            fail(clientRevalidationError());
            return;
          }
          update({ object: value as Partial<T>, value, metadata: event.metadata, isStreaming: false });
          options.onComplete?.(value, event.metadata);
          return;
        }

        case "error": {
          fail(
            new RelaxUIError({
              code: (event.error.code as RelaxUIError["code"]) ?? "transport_error",
              message: event.error.message,
              retryable: event.error.retryable,
              ...(event.error.requestId ? { requestId: event.error.requestId } : {}),
              // Already redacted upstream to pointers and issue codes.
              ...(event.error.details !== undefined ? { details: event.error.details } : {}),
            }),
          );
          return;
        }
      }
    }

    if (plan.kind === "document") {
      // Nothing was generated, so there is no metadata and no `onComplete`:
      // the caller already holds the value it passed in.
      const current = accumulator.current();
      const value = full
        ? (safeParsePartial(plan.schema!, current, true) as { data: T }).data
        : (current as unknown as T);
      update({ object: value as Partial<T>, value, isStreaming: false });
      return;
    }
    update({ isStreaming: false });
  } catch (cause) {
    if (signal.aborted) {
      update({ isStreaming: false });
      return;
    }
    fail(asRelaxUIError(cause));
  }
}

const REFUSED = Symbol("refused");

function finalValue<T>(plan: GenerationPlan<T>, value: T): T | typeof REFUSED {
  if (plan.tier === "full") {
    return check(plan.schema!, value, true) as T;
  }
  // `server` tier: the original behaviour, a re-check of the result only.
  if (!plan.schema) return value;
  const result = plan.schema.safeParse(value as unknown);
  return result.success ? (result.data as T) : REFUSED;
}

/** Throws `schema_violation` with redacted issues; returns the parsed value. */
function check<T>(schema: SchemaLike<T>, value: unknown, finished: boolean): T | undefined {
  const result = safeParsePartial(schema, value, finished);
  if (result.status === "invalid") {
    throw new RelaxUIError({
      code: "schema_violation",
      message: finished
        ? "The document failed validation in the browser and was not rendered."
        : "A frame failed validation in the browser; the stream was stopped and the frame not rendered.",
      // Pointers and issue codes only, never values: the same redaction the
      // server applies, because a foreign document may carry anything.
      details: redactIssues(result.fatalIssues),
    });
  }
  return result.data;
}

function clientRevalidationError(): RelaxUIError {
  return new RelaxUIError({
    code: "schema_violation",
    message:
      "The completed object failed client-side re-validation. The endpoint is not " +
      "producing the schema this component expects.",
  });
}

function asRelaxUIError(cause: unknown): RelaxUIError {
  if (cause instanceof RelaxUIError) return cause;
  return new RelaxUIError({
    code: "transport_error",
    message: cause instanceof Error ? cause.message : String(cause),
    retryable: true,
    cause,
  });
}
