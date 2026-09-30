import { CapabilityRegistry, RelaxClient, type SovereigntyPolicy } from "relax-ui-core";

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

/**
 * Reads `RELAX_UI_PROVIDER`, tolerantly.
 *
 * Case-insensitive, and loud about a value it does not recognise. An exact
 * `=== "ollama"` meant `Ollama` or a typo fell through to relaxAI in silence —
 * which then failed with a missing-key error, or worse, quietly billed the
 * wrong endpoint. A misconfiguration that looks like it worked is the one bug
 * class this whole SDK is meant to avoid, so it should not start in its own demo.
 */
export function resolveProviderId(): ProviderId {
  const raw = env("RELAX_UI_PROVIDER");
  if (raw === undefined) return "relaxai";

  const normalised = raw.toLowerCase();
  if (normalised === "ollama" || normalised === "local") return "ollama";
  if (normalised === "relaxai" || normalised === "relax") return "relaxai";

  console.warn(
    `[relax-ui] RELAX_UI_PROVIDER="${raw}" is not recognised. ` +
      `Expected "relaxai" or "ollama"; falling back to relaxai.`,
  );
  return "relaxai";
}

export const PROVIDER_ID: ProviderId = resolveProviderId();

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
 * Families that ship tool templates, best first.
 *
 * Only a tiebreak. Tool calling is the strongest tier most local models can
 * manage, and a model without a template lands on the prompted floor — which
 * still works, just more expensively.
 */
const TOOL_CAPABLE_FAMILIES = [/^qwen3/i, /^qwen2/i, /^llama3\.[123]/i, /^mistral/i];

/**
 * Parameter count in billions, read from an Ollama tag.
 *
 * Handles `qwen2.5:7b`, `llama3.2:3b-instruct-q4_K_M`, `qwen3:30b-a3b` (takes
 * the total, not the active experts) and `mixtral:8x7b` (multiplies out — a
 * "7b" that is really 56b would otherwise look like a laptop-friendly pick).
 * Returns undefined for `:latest` and anything else unlabelled.
 */
export function parseParamCount(id: string): number | undefined {
  const tag = id.slice(id.indexOf(":") + 1);
  if (tag === id) return undefined; // no tag at all

  const mixture = /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*b\b/i.exec(tag);
  if (mixture) return Number(mixture[1]) * Number(mixture[2]);

  const plain = /(\d+(?:\.\d+)?)\s*b\b/i.exec(tag);
  return plain ? Number(plain[1]) : undefined;
}

/**
 * How much we want a model of this size, lower being better.
 *
 * Tuned for a demo on a developer's own machine, so the goal is the *smallest*
 * model that can still do the job — not the most capable one installed. Someone
 * with both `qwen3:32b` and `qwen2.5:7b` wants the 7b: it fits in memory,
 * answers in seconds, and the point of the demo is the SDK, not the model.
 *
 * The floor matters as much as the ceiling. Sub-1B models cannot reliably
 * produce a nested component tree through a tool call, so picking one by
 * default would make the SDK look broken when the model is what fell over.
 */
function sizeRank(params: number | undefined): number {
  if (params === undefined) return 3; // unlabelled (`:latest`) — middling guess
  if (params >= 3 && params <= 9) return 0; // the sweet spot: 3b, 4b, 7b, 8b
  if (params >= 1 && params < 3) return 1; // quick, occasionally shaky on nesting
  if (params > 9 && params <= 14) return 2; // usable, noticeably slower
  if (params > 14) return 4; // last resort: slow, and may not fit
  return 5; // under 1b — not up to a nested schema
}

/**
 * Binary, not a league table: can this family call tools, or not?
 *
 * Ranking *within* tool-capable families would let a 7b outrank a 3b for no
 * reason a demo cares about. What genuinely matters is the cliff between a
 * model that can use the tool-call tier and one that drops to the prompted
 * floor — so that is the only distinction drawn, and size decides the rest.
 */
function toolRank(id: string): number {
  return TOOL_CAPABLE_FAMILIES.some((pattern) => pattern.test(id)) ? 0 : 1;
}

/**
 * Prefer a model that answers straight away over one that thinks first.
 *
 * Reasoning is a latency cost here, not a capability gain. Measured against
 * qwen3:4b on a 13 tok/s machine: a two-field probe spent ~430 completion
 * tokens inside <think> before the tool call, and the full Dashboard schema ran
 * for nine minutes. Ollama's OpenAI-compatible route offers no way to switch it
 * off — `think: false`, `chat_template_kwargs.enable_thinking` and Qwen's own
 * `/no_think` were all tested against it and all ignored (`think: false` does
 * work on the native /api/chat route, which this SDK does not speak).
 *
 * Read from the SDK's own capability table so there is one list of which
 * families reason, not two.
 */
function reasoningRank(id: string): number {
  return CapabilityRegistry.baseline(id).reasoningTrace ? 1 : 0;
}

/**
 * Orders installed models by how well they suit the demo.
 *
 * Size band, then tool capability, then straight-answering before reasoning,
 * then smaller before larger. The two middle terms are what stop a 3b model with
 * no tool template beating a 7b that has one, and a 4b that thinks for nine
 * minutes beating a 7b that answers in seconds: a smaller model is only better
 * if it can still reach the same tier, in a time someone will wait for.
 */
export function rankOllamaModels(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => {
    const pa = parseParamCount(a);
    const pb = parseParamCount(b);
    return (
      sizeRank(pa) - sizeRank(pb) ||
      toolRank(a) - toolRank(b) ||
      // Tool capability outranks latency because it decides which tier of the
      // ladder the demo shows; reasoning only decides how long that takes.
      reasoningRank(a) - reasoningRank(b) ||
      (pa ?? Number.POSITIVE_INFINITY) - (pb ?? Number.POSITIVE_INFINITY) ||
      a.localeCompare(b)
    );
  });
}

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
    return rankOllamaModels(ids)[0] as string;
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
    // Lower temperature because smaller models wander. The budget is *not*
    // tightened to match: a reasoning model (qwen3 and friends) spends tokens
    // thinking before it writes a single byte of the document, and those count
    // against the same ceiling. A budget that runs out mid-document produces a
    // `truncated` error and nothing to render, which reads as the SDK failing
    // when it is the allowance that was wrong.
    sampling: { temperature: 0.2, max_tokens: 3_000 },
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
