import { CapabilityRegistry, defaultCapabilityRegistry, type ModelCapabilities } from "../capability/registry.js";
import { RelaxUIError } from "../errors.js";
import { DEFAULT_REDACTION_RULES, redact, type RedactionRule } from "../guard/redaction.js";
import { assertSovereignEndpoint, type SovereigntyPolicy } from "../guard/sovereignty.js";
import { decodeSSE, isStreamTerminator } from "../stream/sse.js";
import type {
  ChatCompletionChoice,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  JsonValue,
  ModelDescriptor,
} from "../types.js";
import { HttpClient, type FetchLike, type HttpClientOptions, type RetryPolicy } from "./http.js";

export interface RelaxClientOptions {
  /** relaxAI API key. Read from `RELAX_API_KEY` when omitted. */
  apiKey?: string;
  /** Default `https://api.relax.ai/v1`. */
  baseURL?: string;
  /** Jurisdictional allowlist for the endpoint. See {@link SovereigntyPolicy}. */
  sovereignty?: SovereigntyPolicy;
  /**
   * Outbound prompt redaction. `true` uses {@link DEFAULT_REDACTION_RULES};
   * an array supplies your own; `false` (the default) leaves prompts untouched.
   *
   * Off by default because silently mutating prompts is a surprise, and a
   * surprise in a prompt pipeline is a very expensive debugging session.
   */
  redaction?: boolean | readonly RedactionRule[];
  /** Notified whenever redaction fired, so a deployment can alarm on it. */
  onRedaction?: (hits: Record<string, number>) => void;
  headers?: Record<string, string>;
  fetch?: FetchLike;
  retry?: RetryPolicy;
  /** Per-request timeout in ms. Default 120_000 — generations are slow. */
  timeoutMs?: number;
  capabilities?: CapabilityRegistry;
  onAttempt?: HttpClientOptions["onAttempt"];
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

const DEFAULT_BASE_URL = "https://api.relax.ai/v1";
const SDK_VERSION = "0.1.0";

/**
 * A minimal, sovereignty-aware client for relaxAI's OpenAI-compatible surface.
 *
 * We do not wrap the official `openai` package. Two reasons, both structural:
 * it assumes OpenAI's capability set (so it cannot negotiate down for
 * open-weight models), and it would put a second HTTP stack and a second
 * retry policy inside a library whose whole pitch is a controlled egress path.
 * What is left is small enough to audit in an afternoon, which is the point.
 */
export class RelaxClient {
  readonly baseURL: URL;
  readonly capabilities: CapabilityRegistry;

  private readonly http: HttpClient;
  private readonly apiKey: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly redactionRules: readonly RedactionRule[] | null;
  private readonly onRedaction?: (hits: Record<string, number>) => void;

  constructor(options: RelaxClientOptions = {}) {
    const apiKey = options.apiKey ?? readEnv("RELAX_API_KEY") ?? readEnv("RELAXAI_API_KEY");
    if (!apiKey) {
      throw new RelaxUIError({
        code: "config_invalid",
        message:
          "Missing relaxAI API key. Pass `apiKey` or set RELAX_API_KEY. " +
          "Never inline a key in client-side code — route requests through your own server.",
      });
    }
    this.apiKey = apiKey;

    const baseURL = options.baseURL ?? readEnv("RELAX_BASE_URL") ?? DEFAULT_BASE_URL;
    this.baseURL = assertSovereignEndpoint(baseURL, options.sovereignty);

    this.http = new HttpClient({
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.retry ? { retry: options.retry } : {}),
      ...(options.onAttempt ? { onAttempt: options.onAttempt } : {}),
    });
    this.extraHeaders = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.capabilities = options.capabilities ?? defaultCapabilityRegistry;

    this.redactionRules =
      options.redaction === true
        ? DEFAULT_REDACTION_RULES
        : Array.isArray(options.redaction)
          ? options.redaction
          : null;
    if (options.onRedaction) this.onRedaction = options.onRedaction;
  }

  capabilitiesFor(model: string): ModelCapabilities {
    return this.capabilities.get(model);
  }

  /** `GET /models` — the catalogue this key can actually reach. */
  async listModels(options: RequestOptions = {}): Promise<ModelDescriptor[]> {
    const response = await this.http.send({
      url: this.url("models"),
      method: "GET",
      headers: this.headers(options.headers),
      ...(options.signal ? { signal: options.signal } : {}),
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
    });
    const body = (await response.json()) as { data?: ModelDescriptor[] };
    return body.data ?? [];
  }

  /** `POST /chat/completions` without streaming. */
  async chatCompletion(
    request: ChatCompletionRequest,
    options: RequestOptions = {},
  ): Promise<ChatCompletionResponse> {
    const response = await this.http.send({
      url: this.url("chat/completions"),
      method: "POST",
      headers: this.headers(options.headers),
      body: this.prepare({ ...request, stream: false }),
      ...(options.signal ? { signal: options.signal } : {}),
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
    });
    return (await response.json()) as ChatCompletionResponse;
  }

  /**
   * `POST /chat/completions` with `stream: true`, yielding decoded chunks.
   *
   * Non-JSON `data:` frames are skipped rather than fatal: several
   * OpenAI-compatible servers interleave keep-alive comments and vendor
   * telemetry, and a strict parser turns that into a production outage.
   */
  async *streamChatCompletion(
    request: ChatCompletionRequest,
    options: RequestOptions = {},
  ): AsyncGenerator<ChatCompletionResponse, void, unknown> {
    const response = await this.http.send({
      url: this.url("chat/completions"),
      method: "POST",
      headers: this.headers({ Accept: "text/event-stream", ...options.headers }),
      body: this.prepare({ ...request, stream: true }),
      ...(options.signal ? { signal: options.signal } : {}),
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
    });

    if (!response.body) {
      throw new RelaxUIError({
        code: "stream_malformed",
        message: "relaxAI returned a streaming response with no body.",
      });
    }

    for await (const event of decodeSSE(response.body, options.signal)) {
      if (isStreamTerminator(event)) return;
      if (event.data.trim() === "") continue;
      let chunk: ChatCompletionResponse;
      try {
        chunk = JSON.parse(event.data) as ChatCompletionResponse;
      } catch {
        continue;
      }
      yield chunk;
    }
  }

  private url(path: string): string {
    const base = this.baseURL.pathname.endsWith("/")
      ? this.baseURL.pathname
      : `${this.baseURL.pathname}/`;
    return new URL(`${base}${path}`, this.baseURL).toString();
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": `civo-relax-ui-sdk/${SDK_VERSION}`,
      ...this.extraHeaders,
      ...extra,
    };
  }

  /** Applies redaction to message content immediately before serialisation. */
  private prepare(request: ChatCompletionRequest): JsonValue {
    if (!this.redactionRules) return request as unknown as JsonValue;

    const totals: Record<string, number> = {};
    const messages: ChatMessage[] = request.messages.map((message) => {
      const report = redact(message.content, this.redactionRules ?? undefined);
      for (const [id, count] of Object.entries(report.hits)) {
        totals[id] = (totals[id] ?? 0) + count;
      }
      return report.text === message.content ? message : { ...message, content: report.text };
    });

    if (Object.keys(totals).length > 0) this.onRedaction?.(totals);
    return { ...request, messages } as unknown as JsonValue;
  }
}

/** Merges streamed choice deltas into a single accumulated text buffer. */
export function contentDeltaOf(chunk: ChatCompletionResponse): string {
  const choice: ChatCompletionChoice | undefined = chunk.choices?.[0];
  return choice?.delta?.content ?? "";
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = env?.[name];
  return value && value.length > 0 ? value : undefined;
}
