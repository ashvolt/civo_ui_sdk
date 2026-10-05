import { RelaxUIError } from "../errors.js";
import type { JsonValue } from "../types.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface RetryPolicy {
  /** Attempts *after* the first. 0 disables retrying. Default 2. */
  maxRetries?: number;
  /** First backoff in ms; doubles each attempt. Default 400. */
  baseDelayMs?: number;
  /** Ceiling on a single backoff. Default 8000. */
  maxDelayMs?: number;
  /** Deterministic jitter source; injected in tests. Default `Math.random`. */
  random?: () => number;
  /** Injected in tests so a retry suite does not actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: JsonValue;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AttemptInfo {
  attempt: number;
  status?: number;
  error?: string;
  /** Set when the client is about to back off before trying again. */
  delayMs?: number;
}

export interface HttpClientOptions {
  fetch?: FetchLike;
  retry?: RetryPolicy;
  /** Called once per attempt with the outcome. Never receives request bodies. */
  onAttempt?: (info: AttemptInfo) => void;
  /**
   * Name of the endpoint, used only in error messages. Default "relaxAI".
   *
   * An error that says "relaxAI returned 404" when the request went to a local
   * runtime sends whoever reads it to the wrong system.
   */
  upstream?: string;
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

type Attempt =
  | { kind: "ok"; response: Response }
  | { kind: "fail"; error: RelaxUIError; retryAfter: string | null };

/**
 * The SDK's only network primitive.
 *
 * Deliberately built on `fetch` alone — no axios, no node:http, no undici
 * import. That is what lets the identical code run in a Next.js Edge route, a
 * Node server, a Cloudflare Worker and a test harness with an injected `fetch`.
 * Every dependency added here becomes a dependency of every deployment target.
 */
export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly retry: Required<RetryPolicy>;
  private readonly onAttempt?: (info: AttemptInfo) => void;
  private readonly upstream: string;

  constructor(options: HttpClientOptions = {}) {
    const resolved = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!resolved) {
      throw new RelaxUIError({
        code: "config_invalid",
        message: "No global fetch available. Pass `fetch` explicitly in client options.",
      });
    }
    this.fetchImpl = resolved;
    this.retry = {
      maxRetries: options.retry?.maxRetries ?? 2,
      baseDelayMs: options.retry?.baseDelayMs ?? 400,
      maxDelayMs: options.retry?.maxDelayMs ?? 8_000,
      random: options.retry?.random ?? Math.random,
      sleep: options.retry?.sleep ?? defaultSleep,
    };
    if (options.onAttempt) this.onAttempt = options.onAttempt;
    this.upstream = options.upstream ?? "relaxAI";
  }

  /**
   * Sends `request`, retrying transport failures and retryable statuses with
   * full-jitter exponential backoff. `Retry-After` wins over our own backoff
   * when the server sends one: rate limits are the server's call, not ours.
   */
  async send(request: HttpRequest): Promise<Response> {
    let lastError: RelaxUIError | undefined;

    for (let attempt = 0; attempt <= this.retry.maxRetries; attempt++) {
      const outcome = await this.attemptOnce(request, attempt);

      if (outcome.kind === "ok") return outcome.response;

      lastError = outcome.error;
      const exhausted = attempt >= this.retry.maxRetries;
      if (!outcome.error.retryable || exhausted) throw outcome.error;

      const delayMs = this.backoff(attempt, outcome.retryAfter);
      this.onAttempt?.({ attempt, error: outcome.error.message, delayMs });
      await this.retry.sleep(delayMs);
    }

    throw (
      lastError ??
      new RelaxUIError({ code: "transport_error", message: "Request failed.", retryable: true })
    );
  }

  /** One network attempt. Resolves with an outcome rather than throwing. */
  private async attemptOnce(request: HttpRequest, attempt: number): Promise<Attempt> {
    const controller = new AbortController();
    const forward = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", forward, { once: true });

    let timedOut = false;
    const timer =
      request.timeoutMs && request.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort(new Error("relax-ui:timeout"));
          }, request.timeoutMs)
        : undefined;

    try {
      const init: RequestInit = {
        method: request.method,
        headers: request.headers,
        signal: controller.signal,
      };
      if (request.body !== undefined) init.body = JSON.stringify(request.body);

      const response = await this.fetchImpl(request.url, init);
      this.onAttempt?.({ attempt, status: response.status });

      if (response.ok) return { kind: "ok", response };
      return {
        kind: "fail",
        error: await toHttpError(response, this.upstream),
        retryAfter: response.headers.get("retry-after"),
      };
    } catch (cause) {
      if (timedOut) {
        return {
          kind: "fail",
          retryAfter: null,
          error: new RelaxUIError({
            code: "timeout",
            message: `Request to ${this.upstream} exceeded ${request.timeoutMs}ms.`,
            retryable: true,
            cause,
          }),
        };
      }
      if (request.signal?.aborted) {
        return {
          kind: "fail",
          retryAfter: null,
          error: new RelaxUIError({
            code: "aborted",
            message: "Request aborted by caller.",
            retryable: false,
            cause,
          }),
        };
      }
      const error = new RelaxUIError({
        code: "transport_error",
        message: `Network failure talking to ${this.upstream}: ${describe(cause)}`,
        retryable: true,
        cause,
      });
      this.onAttempt?.({ attempt, error: error.message });
      return { kind: "fail", error, retryAfter: null };
    } finally {
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener("abort", forward);
    }
  }

  private backoff(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const seconds = Number.parseFloat(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, this.retry.maxDelayMs);
      }
    }
    const ceiling = Math.min(this.retry.baseDelayMs * 2 ** attempt, this.retry.maxDelayMs);
    // Full jitter: stops a fleet of pods from retrying in lockstep.
    return Math.round(ceiling * this.retry.random());
  }
}

async function toHttpError(response: Response, upstream: string): Promise<RelaxUIError> {
  let detail = "";
  let parsed: JsonValue | undefined;
  try {
    const text = await response.text();
    detail = text.slice(0, 2_000);
    if (text.trim().startsWith("{")) {
      const body = JSON.parse(text) as { error?: { message?: string } };
      parsed = body as unknown as JsonValue;
      if (body.error?.message) detail = body.error.message;
    }
  } catch {
    // A body we cannot read must not mask the status we can.
  }

  const requestId =
    response.headers.get("x-request-id") ?? response.headers.get("cf-ray") ?? undefined;

  const message = `${upstream} returned ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`;

  // 402 is worth its own code rather than a generic http_error: it is not a bad
  // request, retrying never helps, and the fix is a human adding a payment
  // method. A caller should be able to branch on that without matching text.
  const code =
    response.status === 429 ? "rate_limited" : response.status === 402 ? "payment_required" : "http_error";

  return new RelaxUIError({
    code,
    message,
    status: response.status,
    retryable: RETRYABLE_STATUS.has(response.status),
    ...(requestId ? { requestId } : {}),
    ...(parsed !== undefined ? { details: parsed } : {}),
  });
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
