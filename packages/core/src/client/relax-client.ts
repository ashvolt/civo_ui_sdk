import { relaxai } from "../provider/profile.js";
import { OpenAICompatibleClient, type OpenAICompatibleClientOptions } from "./openai-compatible-client.js";

export { contentDeltaOf } from "./openai-compatible-client.js";
export type { RequestOptions } from "./inference-client.js";

/** Options for {@link RelaxClient}: everything but the choice of provider. */
export type RelaxClientOptions = Omit<OpenAICompatibleClientOptions, "provider">;

/**
 * The relaxAI client: {@link OpenAICompatibleClient} with the provider fixed.
 *
 * Kept as its own class, rather than folded into a factory, for the
 * application that wants the endpoint to be a property of its *code*. A
 * `RelaxClient` cannot be pointed at another provider by an environment
 * variable — it reads `RELAX_API_KEY` and `RELAX_BASE_URL`, enforces relaxAI's
 * allowlist unless handed another, and that is all it will ever do.
 */
export class RelaxClient extends OpenAICompatibleClient {
  constructor(options: RelaxClientOptions = {}) {
    super({ ...options, provider: relaxai });
  }
}
