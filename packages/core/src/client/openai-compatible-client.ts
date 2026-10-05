import {
  capabilityRegistryFor,
  CapabilityRegistry,
  defaultCapabilityRegistry,
  type ModelCapabilities,
} from "../capability/registry.js";
import { RelaxUIError } from "../errors.js";
import { DEFAULT_REDACTION_RULES, redact, type RedactionRule } from "../guard/redaction.js";
import { assertSovereignEndpoint, type SovereigntyPolicy } from "../guard/sovereignty.js";
import {
  describeProvider,
  relaxai,
  resolveProvider,
  type ProviderDescriptor,
  type ProviderProfile,
  type SchemaDialect,
} from "../provider/profile.js";
import { decodeSSE, isStreamTerminator } from "../stream/sse.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  JsonValue,
  ModelDescriptor,
} from "../types.js";
import { readEnv, readFirstEnv } from "./env.js";
import { HttpClient, type FetchLike, type HttpClientOptions, type RetryPolicy } from "./http.js";
import type { InferenceClient, RequestOptions } from "./inference-client.js";

export interface OpenAICompatibleClientOptions {
  /**
   * Which endpoint to talk to: a built-in name (`relaxai`, `ollama`,
   * `lmstudio`, `llamacpp`) or a profile from `defineProvider`. Default
   * `relaxai`.
   *
   * An unknown name throws. It does not fall back to the default — that would
   * send prompts somewhere the deployment did not choose.
   */
  provider?: string | ProviderProfile;
  /** API key. Read from the provider's environment variables when omitted. */
  apiKey?: string;
  /** Overrides the provider's base URL. Still subject to its egress policy. */
  baseURL?: string;
  /**
   * Replaces the provider's egress policy. The only way to widen who may be
   * dialled — deliberately not something an environment variable can do.
   */
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
  /** Per-request timeout in ms. Default: the provider's, else 120_000. */
  timeoutMs?: number;
  capabilities?: CapabilityRegistry;
  onAttempt?: HttpClientOptions["onAttempt"];
}

const SDK_VERSION = "0.1.0";

/**
 * A minimal, egress-controlled client for any OpenAI-compatible endpoint.
 *
 * We do not wrap the official `openai` package. Two reasons, both structural:
 * it assumes OpenAI's capability set (so it cannot negotiate down for
 * open-weight models), and it would put a second HTTP stack and a second
 * retry policy inside a library whose whole pitch is a controlled egress path.
 * What is left is small enough to audit in an afternoon, which is the point.
 *
 * The endpoint-specific facts come from a {@link ProviderProfile}. The
 * sovereignty guard runs in the constructor for every provider; a local
 * provider is not exempt from it, it simply carries a loopback-only policy.
 */
export class OpenAICompatibleClient implements InferenceClient {
  readonly baseURL: URL;
  readonly capabilities: CapabilityRegistry;
  readonly provider: ProviderDescriptor;
  readonly schemaDialect?: SchemaDialect;

  private readonly http: HttpClient;
  private readonly apiKey: string | undefined;
  private readonly extraHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly redactionRules: readonly RedactionRule[] | null;
  private readonly onRedaction?: (hits: Record<string, number>) => void;

  constructor(options: OpenAICompatibleClientOptions = {}) {
    const profile = resolveProvider(options.provider ?? relaxai);
    this.provider = describeProvider(profile);
    if (profile.schemaDialect) this.schemaDialect = profile.schemaDialect;

    this.apiKey = options.apiKey ?? readFirstEnv(profile.apiKeyEnv);
    if (!this.apiKey && profile.requiresApiKey) {
      const variable = profile.apiKeyEnv?.[0];
      throw new RelaxUIError({
        code: "config_invalid",
        message:
          `Missing ${profile.label} API key. Pass \`apiKey\`${variable ? ` or set ${variable}` : ""}. ` +
          "Never inline a key in client-side code — route requests through your own server.",
      });
    }

    const baseURL = options.baseURL ?? readFirstEnv(profile.baseURLEnv) ?? profile.baseURL;
    this.baseURL = assertSovereignEndpoint(baseURL, options.sovereignty ?? profile.egress);

    this.http = new HttpClient({
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.retry ? { retry: options.retry } : {}),
      ...(options.onAttempt ? { onAttempt: options.onAttempt } : {}),
      upstream: profile.label,
    });
    this.extraHeaders = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? profile.timeoutMs ?? 120_000;
    this.capabilities = options.capabilities ?? sharedRegistry(profile, this.baseURL);

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

  /** `GET /models` — the catalogue this endpoint can actually serve. */
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
        message: `${this.provider.label} returned a streaming response with no body.`,
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
      // A keyless provider gets no Authorization header at all, rather than a
      // placeholder token that would look like a credential in a proxy log.
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
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

/**
 * The registry every client of this endpoint shares.
 *
 * Scoped by provider *and* origin: two Ollama instances on different ports may
 * be different versions with different behaviour. relaxAI at its public address
 * keeps the process-wide default, which is what feature 001's applications
 * already seed and inspect.
 */
function sharedRegistry(profile: ProviderProfile, baseURL: URL): CapabilityRegistry {
  if (profile.id === relaxai.id && baseURL.origin === new URL(relaxai.baseURL).origin) {
    return defaultCapabilityRegistry;
  }
  return capabilityRegistryFor(
    `${profile.id}|${baseURL.origin}`,
    profile.capabilities ? { endpointDefaults: profile.capabilities } : {},
  );
}

/**
 * Builds a client for the provider the deployment selected.
 *
 * The provider comes from `options.provider`, else `RELAX_UI_PROVIDER`, else
 * relaxAI. This is the one place the SDK lets the environment choose the
 * endpoint, and it is opt-in by construction: an application that wants the
 * choice fixed in code uses `new RelaxClient()` or passes `provider`.
 */
export function createClient(options: OpenAICompatibleClientOptions = {}): OpenAICompatibleClient {
  const provider = options.provider ?? readEnv("RELAX_UI_PROVIDER") ?? relaxai;
  return new OpenAICompatibleClient({ ...options, provider });
}

/** Merges streamed choice deltas into a single accumulated text buffer. */
export function contentDeltaOf(chunk: ChatCompletionResponse): string {
  return chunk.choices?.[0]?.delta?.content ?? "";
}
