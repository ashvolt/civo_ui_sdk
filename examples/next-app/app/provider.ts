import { RelaxClient, type SovereigntyPolicy } from "relax-ui-core";

/**
 * Which inference endpoint this demo talks to.
 *
 * relaxAI is the default and the point of the SDK. Local mode exists so the
 * demo can be run — and reviewed — without a relaxAI account, and because
 * pointing the same code at a second, only-partially-compatible OpenAI endpoint
 * is the clearest possible demonstration of what the capability ladder is for:
 * Ollama and relaxAI disagree about constrained decoding and tool calling, and
 * the SDK negotiates that difference rather than assuming it away.
 *
 * What local mode is NOT is a way around the sovereignty guard. The guard still
 * runs, it is just handed a deliberately narrow policy: loopback hosts only,
 * and plaintext permitted only because the traffic never leaves the machine.
 * Anything wider is refused exactly as it would be in production. If that
 * distinction stops being visible, this file is wrong — see `isSovereign`,
 * which the UI uses to say so out loud.
 */

export type ProviderId = "relaxai" | "ollama";

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  /** False for local mode, and surfaced in the UI. Never quietly true. */
  isSovereign: boolean;
  client: RelaxClient;
  /** A fixed name, or a resolver that asks the endpoint what it has. */
  model: string | ((request: Request) => Promise<string>);
  /** Local models are slower and smaller; the demo adapts its ask. */
  sampling: { temperature: number; max_tokens: number };
  frameIntervalMs: number;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export const PROVIDER_ID: ProviderId = env("RELAX_UI_PROVIDER") === "ollama" ? "ollama" : "relaxai";

// --- local (Ollama) ---------------------------------------------------------

const OLLAMA_BASE_URL = env("OLLAMA_BASE_URL") ?? "http://127.0.0.1:11434/v1";

/**
 * Loopback only. `allowInsecureTransport` is what permits `http://`, and the
 * guard still refuses it for any non-loopback host — so this policy cannot be
 * repurposed to reach a remote endpoint in the clear.
 */
const LOOPBACK_ONLY: SovereigntyPolicy = {
  allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
  allowInsecureTransport: true,
};

/**
 * Models we would rather pick, best first.
 *
 * Not a hard requirement — the resolver falls back to whatever is installed —
 * but tool calling is the tier most local models can actually manage, and these
 * families ship with tool templates. A model without one lands on the prompted
 * floor, which still works, just more expensively.
 */
const PREFERRED = [/^qwen3/i, /^qwen2\.5/i, /^llama3\.[23]/i, /^llama3\.1/i, /^mistral/i, /^gemma[23]/i];

let cachedModel: Promise<string> | undefined;

/**
 * Asks Ollama what is installed and picks one.
 *
 * Resolved lazily and memoised rather than at module scope: a dev server should
 * start even when Ollama is not running, and fail with a clear message on the
 * first request instead of refusing to boot.
 */
async function resolveOllamaModel(client: RelaxClient): Promise<string> {
  const pinned = env("OLLAMA_MODEL");
  if (pinned) return pinned;

  cachedModel ??= (async () => {
    const models = await client.listModels();
    const ids = models.map((m) => m.id).filter(Boolean);
    if (ids.length === 0) {
      throw new Error(
        `Ollama at ${OLLAMA_BASE_URL} has no models installed. Run e.g. \`ollama pull qwen2.5\`, ` +
          `or set OLLAMA_MODEL to one you have.`,
      );
    }
    for (const pattern of PREFERRED) {
      const match = ids.find((id) => pattern.test(id));
      if (match) return match;
    }
    return ids[0] as string;
  })();

  try {
    return await cachedModel;
  } catch (error) {
    cachedModel = undefined; // so a later request retries rather than caching the failure
    throw error;
  }
}

// --- resolution -------------------------------------------------------------

function buildRelaxAI(): ProviderConfig {
  const client = new RelaxClient({
    redaction: true,
    onRedaction: (hits) => console.warn("[relax-ui] redacted outbound prompt", hits),
  });
  return {
    id: "relaxai",
    label: `relaxAI (${client.baseURL.host})`,
    isSovereign: true,
    client,
    model: env("RELAX_MODEL") ?? "Llama-4-Maverick-17B-128E",
    sampling: { temperature: 0.4, max_tokens: 2_000 },
    frameIntervalMs: 50,
  };
}

function buildOllama(): ProviderConfig {
  const client = new RelaxClient({
    baseURL: OLLAMA_BASE_URL,
    sovereignty: LOOPBACK_ONLY,
    // Ollama ignores the bearer token; RelaxClient requires one to exist.
    apiKey: "ollama-local",
    // Local generation is slow, and a stalled model should not hold a request
    // open for the full two minutes.
    timeoutMs: 300_000,
  });

  return {
    id: "ollama",
    label: `local Ollama (${client.baseURL.host})`,
    isSovereign: false,
    client,
    model: () => resolveOllamaModel(client),
    // Smaller models wander. Lower temperature and a tighter budget keep the
    // document inside the node limit and the demo inside a sensible wait.
    sampling: { temperature: 0.2, max_tokens: 1_200 },
    // Local token rates are lower, so a tighter throttle buys nothing.
    frameIntervalMs: 80,
  };
}

/**
 * Provider identity without building a client.
 *
 * The page needs to label the endpoint, and must not need an API key to do it —
 * constructing a `RelaxClient` would throw during render when `RELAX_API_KEY`
 * is unset, which is exactly the state someone reviewing the demo is in.
 */
export function describeProvider(): { id: ProviderId; label: string; isSovereign: boolean } {
  if (PROVIDER_ID === "ollama") {
    return { id: "ollama", label: `local Ollama (${hostOf(OLLAMA_BASE_URL)})`, isSovereign: false };
  }
  const baseURL = env("RELAX_BASE_URL") ?? "https://api.relax.ai/v1";
  return { id: "relaxai", label: `relaxAI (${hostOf(baseURL)})`, isSovereign: true };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

let cached: ProviderConfig | undefined;

/** The active provider. Built once per server process. */
export function getProvider(): ProviderConfig {
  cached ??= PROVIDER_ID === "ollama" ? buildOllama() : buildRelaxAI();
  return cached;
}
