import {
  generateObject,
  RelaxUIError,
  streamObject,
  toSSEStream,
  type ChatMessage,
  type GenerationTrace,
  type RelaxClient,
  type SamplingParams,
  type SchemaLike,
  type StructuredSchema,
  type StructuringStrategyName,
} from "relax-ui-core";

/**
 * Next.js App Router adapter.
 *
 * The entire server side of a generative UI feature is one exported handler.
 * What it does *not* accept from the browser is the interesting part: the
 * model, the schema, the system prompt and the sampling parameters are all
 * fixed by the application at construction time.
 *
 * That is not an ergonomic simplification. A route that lets the client pick
 * the model is a bill; a route that lets the client supply the schema or the
 * system prompt is a jailbreak with a REST interface. The browser gets to
 * supply data, and the application decides what that data means.
 */

export interface GenerativeUIRouteConfig<TInput, TObject> {
  /** Built once at module scope, so the key never enters a request path. */
  client: RelaxClient;
  model: string;
  schema: StructuredSchema<TObject>;
  /** Validates the request body. Anything that fails is a 400, not a prompt. */
  inputSchema: SchemaLike<TInput>;
  /** Turns validated input into the conversation. The app owns the prompt. */
  toMessages: (input: TInput, request: Request) => ChatMessage[] | Promise<ChatMessage[]>;
  system?: string;
  sampling?: SamplingParams;
  /**
   * Called before any inference. Return a `Response` to reject the request
   * (auth, quota, feature flag); return `undefined` to proceed.
   */
  authorize?: (request: Request) => Promise<Response | undefined> | Response | undefined;
  allowStrategies?: readonly StructuringStrategyName[];
  maxRepairAttempts?: number;
  frameIntervalMs?: number;
  transport?: "patch" | "snapshot";
  /** Server-side observability. Receives no prompt or completion text. */
  onEvent?: (event: GenerationTrace) => void;
  /** Hard ceiling on one generation, in ms. Default 120_000. */
  timeoutMs?: number;
}

export type GenerativeUIRouteHandler = (request: Request) => Promise<Response>;

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Nginx and several CDNs buffer unknown content types by default, which turns
  // a streaming route into a slow non-streaming one with no error to explain it.
  "X-Accel-Buffering": "no",
};

/**
 * Builds a POST handler that streams a schema-valid object to the browser.
 *
 * ```ts
 * // app/api/dashboard/route.ts
 * export const runtime = "edge";
 * export const POST = createGenerativeUIRoute({ ... });
 * ```
 */
export function createGenerativeUIRoute<TInput, TObject>(
  config: GenerativeUIRouteConfig<TInput, TObject>,
): GenerativeUIRouteHandler {
  return async function POST(request: Request): Promise<Response> {
    const rejection = await config.authorize?.(request);
    if (rejection) return rejection;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "invalid_request", "Request body must be JSON.");
    }

    const parsed = config.inputSchema.safeParse(body);
    if (!parsed.success) {
      // Echo the failing paths, never the values: the body may hold user data.
      const paths = (parsed.error?.issues ?? [])
        .map((issue) => (issue.path ?? []).join("."))
        .filter(Boolean);
      return errorResponse(400, "invalid_request", "Request body failed validation.", { paths });
    }

    let messages: ChatMessage[];
    try {
      messages = await config.toMessages(parsed.data as TInput, request);
    } catch (cause) {
      if (cause instanceof Response) return cause;
      return errorResponse(400, "invalid_request", "Could not build the conversation from input.");
    }

    // The client's AbortSignal reaches relaxAI, so a closed tab stops a
    // generation instead of paying for tokens nobody will read.
    const events = streamObject<TObject>({
      client: config.client,
      model: config.model,
      schema: config.schema,
      messages,
      ...(config.system ? { system: config.system } : {}),
      ...(config.sampling ? { sampling: config.sampling } : {}),
      ...(config.allowStrategies ? { allowStrategies: config.allowStrategies } : {}),
      ...(config.maxRepairAttempts !== undefined
        ? { maxRepairAttempts: config.maxRepairAttempts }
        : {}),
      ...(config.frameIntervalMs !== undefined ? { frameIntervalMs: config.frameIntervalMs } : {}),
      ...(config.transport ? { transport: config.transport } : {}),
      ...(config.onEvent ? { onEvent: config.onEvent } : {}),
      timeoutMs: config.timeoutMs ?? 120_000,
      signal: request.signal,
    });

    return new Response(toSSEStream(events), { status: 200, headers: SSE_HEADERS });
  };
}

/**
 * Non-streaming variant, for a server component or an action that wants the
 * finished object rather than the frames on the way to it.
 */
export function createGenerativeObjectRoute<TInput, TObject>(
  config: GenerativeUIRouteConfig<TInput, TObject>,
): GenerativeUIRouteHandler {
  return async function POST(request: Request): Promise<Response> {
    const rejection = await config.authorize?.(request);
    if (rejection) return rejection;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "invalid_request", "Request body must be JSON.");
    }

    const parsed = config.inputSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, "invalid_request", "Request body failed validation.");
    }

    try {
      const messages = await config.toMessages(parsed.data as TInput, request);
      const result = await generateObject<TObject>({
        client: config.client,
        model: config.model,
        schema: config.schema,
        messages,
        ...(config.system ? { system: config.system } : {}),
        ...(config.sampling ? { sampling: config.sampling } : {}),
        ...(config.allowStrategies ? { allowStrategies: config.allowStrategies } : {}),
        ...(config.maxRepairAttempts !== undefined
          ? { maxRepairAttempts: config.maxRepairAttempts }
          : {}),
        ...(config.onEvent ? { onEvent: config.onEvent } : {}),
        timeoutMs: config.timeoutMs ?? 120_000,
        signal: request.signal,
      });
      return Response.json({ object: result.object, metadata: result.metadata });
    } catch (cause) {
      if (cause instanceof RelaxUIError) {
        return errorResponse(statusFor(cause), cause.code, cause.message);
      }
      return errorResponse(500, "internal_error", "Generation failed.");
    }
  };
}

function statusFor(error: RelaxUIError): number {
  switch (error.code) {
    case "config_invalid":
    case "capability_unsupported":
      return 500;
    case "rate_limited":
      return 429;
    case "timeout":
      return 504;
    case "aborted":
      return 499;
    case "schema_violation":
    case "unrepairable":
      return 502;
    default:
      return error.status && error.status >= 400 ? error.status : 500;
  }
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return Response.json({ error: { code, message, ...extra } }, { status });
}
