import type { ModelCapabilities } from "../capability/registry.js";
import { RelaxUIError } from "../errors.js";
import type { SovereigntyPolicy } from "../guard/sovereignty.js";

/**
 * What the SDK needs to know about one kind of inference endpoint.
 *
 * relaxAI is the default and the reason the SDK exists, but nothing in the
 * engine depends on it: the ladder, the partial parser, the validator and the
 * wire protocol are endpoint-agnostic. A profile is where the endpoint-specific
 * facts live instead of being scattered through the client as defaults — the
 * address, who may be dialled, whether a key is needed, and how this server's
 * behaviour differs from what a model's name alone would predict.
 *
 * A profile is data. It performs no I/O and is safe to construct at module
 * scope on any runtime.
 */
export interface ProviderProfile {
  /** Stable identifier: lowercase, `^[a-z][a-z0-9-]{0,31}$`. Appears on the wire. */
  readonly id: string;
  /** Human-readable name, for logs and for the application's own UI. */
  readonly label: string;
  /** Used when neither the client options nor the environment supply one. */
  readonly baseURL: string;
  /** Environment variables consulted for the base URL, first match wins. */
  readonly baseURLEnv?: readonly string[];
  /** Environment variables consulted for the API key, first match wins. */
  readonly apiKeyEnv?: readonly string[];
  /**
   * When true, constructing a client without a key is a configuration error.
   * Local runtimes ignore the bearer token, so they do not require one — but a
   * key that *is* supplied is still sent, for a gateway behind an auth proxy.
   */
  readonly requiresApiKey: boolean;
  /**
   * Who this provider may dial. The guard runs for every provider; this is its
   * default policy, replaced only by an explicit `sovereignty` client option.
   */
  readonly egress: SovereigntyPolicy;
  /**
   * True only where the provider makes a jurisdictional guarantee about where
   * inference runs. Never inferred: a model on your own laptop keeps prompts on
   * the machine, which is a *locality* property (see `local`) and not a legal
   * one, so it is not labelled sovereign.
   */
  readonly sovereign: boolean;
  /** True when the default endpoint is on this machine. */
  readonly local: boolean;
  /**
   * Refines the model-name prior for this endpoint.
   *
   * Capability belongs to the (endpoint, model) pair: constrained decoding in
   * particular is a *server* feature, so the same weights can support it behind
   * one runtime and not another. Applied to chat models only, and overridden in
   * turn by anything observed at runtime.
   */
  readonly capabilities?: Partial<ModelCapabilities>;
  /** How this endpoint's constrained decoder departs from JSON Schema. */
  readonly schemaDialect?: SchemaDialect;
  /** Per-request timeout in ms, when this provider wants a different default. */
  readonly timeoutMs?: number;
  /** Provenance, so an operator can see where a claim came from. */
  readonly note?: string;
}

/**
 * The JSON Schema keywords an endpoint's constrained decoder cannot honour.
 *
 * Exists because of a specific, measured failure: a server that accepts a
 * schema, answers 200, and silently generates unconstrained because one keyword
 * defeated its grammar compiler. Nothing reports it, so the ladder cannot
 * react — the only defence is not to send the keyword.
 *
 * This changes what the model is *told*, never what is *accepted*: the
 * application's full schema still validates every document.
 */
export interface SchemaDialect {
  readonly unsupportedKeywords: readonly string[];
}

/** The subset of a profile that travels with a client and with each result. */
export interface ProviderDescriptor {
  readonly id: string;
  readonly label: string;
  readonly sovereign: boolean;
  readonly local: boolean;
}

/** Loopback only, and plaintext only because the traffic never leaves the host. */
export const LOOPBACK_ONLY_POLICY: SovereigntyPolicy = Object.freeze({
  allowedHosts: Object.freeze(["localhost", "127.0.0.1", "[::1]"]),
  allowInsecureTransport: true,
});

const ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Validates and freezes a profile.
 *
 * Fails at definition time rather than at first request: a profile is written
 * once, at module scope, and a mistake in it should not wait for traffic.
 */
export function defineProvider(profile: ProviderProfile): ProviderProfile {
  if (!ID_PATTERN.test(profile.id)) {
    throw new RelaxUIError({
      code: "config_invalid",
      message: `Provider id "${profile.id}" is invalid. Use lowercase letters, digits and hyphens, starting with a letter.`,
    });
  }
  try {
    new URL(profile.baseURL);
  } catch (cause) {
    throw new RelaxUIError({
      code: "config_invalid",
      message: `Provider "${profile.id}" has a baseURL that is not an absolute URL: ${profile.baseURL}`,
      cause,
    });
  }
  if (profile.sovereign && profile.egress.allowInsecureTransport === true) {
    // A provider cannot claim a jurisdictional guarantee and permit plaintext
    // in the same breath; one of the two statements is wrong.
    throw new RelaxUIError({
      code: "config_invalid",
      message: `Provider "${profile.id}" is declared sovereign but permits insecure transport.`,
    });
  }
  return Object.freeze({ ...profile });
}

// --- built-in profiles ------------------------------------------------------

/** Civo relaxAI: UK data centres, UK jurisdiction. The default. */
export const relaxai: ProviderProfile = defineProvider({
  id: "relaxai",
  label: "relaxAI",
  baseURL: "https://api.relax.ai/v1",
  baseURLEnv: ["RELAX_BASE_URL"],
  apiKeyEnv: ["RELAX_API_KEY", "RELAXAI_API_KEY"],
  requiresApiKey: true,
  egress: { allowedHosts: ["api.relax.ai"] },
  sovereign: true,
  local: false,
  note: "Civo relaxAI public endpoint.",
});

/**
 * Ollama's OpenAI-compatible route.
 *
 * Both refinements below are measurements, not documentation (Ollama 0.35.0,
 * 2026-10-05; see specs/002-provider-agnostic-inference/research.md R2-R4):
 *
 * - `jsonSchema: true` — Ollama compiles the schema to a grammar server-side,
 *   whatever the model, and streams the result token by token. Its tool calls,
 *   by contrast, arrive whole in a single chunk, so the tool tier paints the
 *   document all at once. Preferring the constrained tier is what makes a local
 *   generation actually stream.
 * - `pattern` — a schema carrying it is accepted with a 200 and then not
 *   enforced at all.
 */
export const ollama: ProviderProfile = defineProvider({
  id: "ollama",
  label: "Ollama",
  baseURL: "http://127.0.0.1:11434/v1",
  baseURLEnv: ["OLLAMA_BASE_URL"],
  apiKeyEnv: ["OLLAMA_API_KEY"],
  requiresApiKey: false,
  egress: LOOPBACK_ONLY_POLICY,
  sovereign: false,
  local: true,
  capabilities: { jsonSchema: true },
  schemaDialect: { unsupportedKeywords: ["pattern"] },
  // CPU inference of a nested document routinely outlasts two minutes.
  timeoutMs: 300_000,
  note: "Measured against Ollama 0.35.0 on 2026-10-05.",
});

/**
 * LM Studio's local server.
 *
 * A prior, not a measurement: no capability refinement is claimed, so models
 * start from their name-based prior and the ladder discovers the rest.
 */
export const lmstudio: ProviderProfile = defineProvider({
  id: "lmstudio",
  label: "LM Studio",
  baseURL: "http://127.0.0.1:1234/v1",
  baseURLEnv: ["LMSTUDIO_BASE_URL"],
  apiKeyEnv: ["LMSTUDIO_API_KEY"],
  requiresApiKey: false,
  egress: LOOPBACK_ONLY_POLICY,
  sovereign: false,
  local: true,
  timeoutMs: 300_000,
  note: "Prior from LM Studio's documentation; unmeasured.",
});

/** llama.cpp's `llama-server`. A prior, like {@link lmstudio}. */
export const llamacpp: ProviderProfile = defineProvider({
  id: "llamacpp",
  label: "llama.cpp",
  baseURL: "http://127.0.0.1:8080/v1",
  baseURLEnv: ["LLAMACPP_BASE_URL"],
  apiKeyEnv: ["LLAMACPP_API_KEY"],
  requiresApiKey: false,
  egress: LOOPBACK_ONLY_POLICY,
  sovereign: false,
  local: true,
  timeoutMs: 300_000,
  note: "Prior from llama.cpp's server documentation; unmeasured.",
});

/** Built-in profiles by id. Frozen: an application adds its own by passing it. */
export const BUILT_IN_PROVIDERS: Readonly<Record<string, ProviderProfile>> = Object.freeze({
  relaxai,
  ollama,
  lmstudio,
  llamacpp,
});

/** Aliases people actually type. Resolved before lookup, case-insensitively. */
const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  relax: "relaxai",
  local: "ollama",
  "lm-studio": "lmstudio",
  "llama.cpp": "llamacpp",
  "llama-cpp": "llamacpp",
});

/**
 * Turns a provider name (or a profile) into a profile.
 *
 * An unknown name is an error, never a fallback. Falling back to the default
 * would send prompts to an endpoint the deployment did not choose, and report
 * success while doing it.
 *
 * @throws {RelaxUIError} `config_invalid`, listing the names that do exist.
 */
export function resolveProvider(provider: string | ProviderProfile): ProviderProfile {
  if (typeof provider !== "string") return defineProvider(provider);

  const key = provider.trim().toLowerCase();
  const profile = BUILT_IN_PROVIDERS[ALIASES[key] ?? key];
  if (profile) return profile;

  throw new RelaxUIError({
    code: "config_invalid",
    message:
      `Unknown inference provider "${provider}". Built-in providers: ` +
      `${Object.keys(BUILT_IN_PROVIDERS).join(", ")}. Pass a ProviderProfile to use any other endpoint.`,
    details: { provider, known: Object.keys(BUILT_IN_PROVIDERS) },
  });
}

export function describeProvider(profile: ProviderProfile): ProviderDescriptor {
  return { id: profile.id, label: profile.label, sovereign: profile.sovereign, local: profile.local };
}
