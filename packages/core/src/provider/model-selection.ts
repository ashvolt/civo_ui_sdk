import { CapabilityRegistry } from "../capability/registry.js";
import type { InferenceClient, RequestOptions } from "../client/inference-client.js";
import { RelaxUIError } from "../errors.js";

/**
 * Choosing a model from whatever a local runtime happens to have installed.
 *
 * A hosted catalogue is chosen from deliberately, once, by whoever owns the
 * deployment. A local runtime is different: the list is whatever the developer
 * pulled last month, and "which of these should a first run use" needs an
 * answer that does not involve reading documentation. This is that answer, and
 * it is a heuristic — an application that knows which model it wants names it.
 */

/**
 * Families that ship tool templates.
 *
 * Only a tiebreak. Where the endpoint constrains decoding itself the tool tier
 * is never reached; where it does not, this decides whether a model lands on
 * the tool tier or the prompted floor.
 */
const TOOL_CAPABLE_FAMILIES = [/^qwen3/i, /^qwen2/i, /^llama3\.[123]/i, /^mistral/i];

/**
 * Parameter count in billions, read from an Ollama-style tag.
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
 * Tuned for a developer's own machine, so the goal is the *smallest* model that
 * can still do the job — not the most capable one installed. Someone with both
 * `qwen3:32b` and `qwen2.5:7b` wants the 7b: it fits in memory and answers in
 * seconds.
 *
 * The floor matters as much as the ceiling. Sub-1B models cannot reliably
 * produce a nested component tree, so picking one by default would make the
 * SDK look broken when the model is what fell over.
 */
function sizeRank(params: number | undefined): number {
  if (params === undefined) return 3; // unlabelled (`:latest`) — middling guess
  if (params >= 3 && params <= 9) return 0; // the sweet spot: 3b, 4b, 7b, 8b
  if (params >= 1 && params < 3) return 1; // quick, occasionally shaky on nesting
  if (params > 9 && params <= 14) return 2; // usable, noticeably slower
  if (params > 14) return 4; // last resort: slow, and may not fit
  return 5; // under 1b — not up to a nested schema
}

/** Binary, not a league table: can this family call tools, or not? */
function toolRank(id: string): number {
  return TOOL_CAPABLE_FAMILIES.some((pattern) => pattern.test(id)) ? 0 : 1;
}

/**
 * Prefer a model that answers straight away over one that thinks first.
 *
 * Reasoning is a latency cost here, not a capability gain: measured against
 * qwen3:4b at 13 tok/s, a two-field probe spent ~430 completion tokens thinking
 * before its answer. Read from the SDK's own capability table so there is one
 * list of which families reason, not two.
 */
function reasoningRank(id: string): number {
  return CapabilityRegistry.baseline(id).reasoningTrace ? 1 : 0;
}

/**
 * Orders model ids by how well they suit a structured generation on local
 * hardware, best first. Embedding and rerank models are removed, not ranked
 * last: selecting one is never the right answer to "which chat model".
 *
 * Size band, then tool capability, then straight-answering before reasoning,
 * then smaller before larger.
 */
export function rankChatModels(ids: readonly string[]): string[] {
  return ids
    .filter((id) => id !== "" && CapabilityRegistry.baseline(id).chatCapable)
    .sort((a, b) => {
      const pa = parseParamCount(a);
      const pb = parseParamCount(b);
      return (
        sizeRank(pa) - sizeRank(pb) ||
        toolRank(a) - toolRank(b) ||
        reasoningRank(a) - reasoningRank(b) ||
        (pa ?? Number.POSITIVE_INFINITY) - (pb ?? Number.POSITIVE_INFINITY) ||
        a.localeCompare(b)
      );
    });
}

/** The best-suited chat model among `ids`, or undefined when there is none. */
export function pickChatModel(ids: readonly string[]): string | undefined {
  return rankChatModels(ids)[0];
}

/**
 * Asks the endpoint what it has and picks a chat model.
 *
 * For local runtimes, where the catalogue is whatever happens to be installed.
 * Throws rather than returning a guess: an endpoint with nothing usable should
 * fail with a sentence someone can act on, not with a 404 for a model name the
 * SDK made up.
 *
 * @throws {RelaxUIError} `config_invalid` when no chat model is listed.
 */
export async function discoverChatModel(
  client: InferenceClient,
  options: RequestOptions = {},
): Promise<string> {
  const ids = (await client.listModels(options)).map((model) => model.id).filter(Boolean);
  const picked = pickChatModel(ids);
  if (picked) return picked;

  const label = client.provider?.label ?? "The endpoint";
  throw new RelaxUIError({
    code: "config_invalid",
    message:
      ids.length === 0
        ? `${label} lists no models. Install one (for Ollama: \`ollama pull qwen2.5:7b\`) or name a model explicitly.`
        : `${label} lists no chat-capable model (found only: ${ids.join(", ")}). Install one or name a model explicitly.`,
  });
}
