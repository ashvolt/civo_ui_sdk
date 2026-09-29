import { RelaxUIError } from "../errors.js";
import { STRATEGY_PRECEDENCE, type StructuringStrategyName } from "../types.js";
import { CapabilityRegistry, type ModelCapabilities } from "./registry.js";

export interface NegotiationInput {
  model: string;
  registry?: CapabilityRegistry;
  /** Restricts the strategies the caller is willing to accept. */
  allow?: readonly StructuringStrategyName[];
  /** Forces one strategy, skipping negotiation. Errors if the model cannot do it. */
  force?: StructuringStrategyName;
}

export interface NegotiationResult {
  /** Best available strategy. */
  strategy: StructuringStrategyName;
  /** Remaining fallbacks, strongest first, to try if `strategy` fails at runtime. */
  fallbacks: StructuringStrategyName[];
  capabilities: ModelCapabilities;
}

function supports(capabilities: ModelCapabilities, strategy: StructuringStrategyName): boolean {
  switch (strategy) {
    case "native_json_schema":
      return capabilities.jsonSchema;
    case "tool_call":
      return capabilities.toolCalling;
    case "prompted_json":
      // Every chat model can be *asked* for JSON. Whether it complies is what
      // the repair loop is for.
      return true;
  }
}

/**
 * Picks the strongest structuring strategy the model is believed to support, and
 * the ladder to walk down if that belief turns out to be wrong.
 *
 * Negotiating rather than hard-coding is the difference between "works on the
 * model I tested" and "works across the catalogue" — and relaxAI's catalogue
 * changes as new open-weight models land.
 */
export function negotiateStrategy(input: NegotiationInput): NegotiationResult {
  const registry = input.registry ?? new CapabilityRegistry();
  const capabilities = registry.get(input.model);

  if (!capabilities.chatCapable) {
    throw new RelaxUIError({
      code: "capability_unsupported",
      message:
        `Model "${input.model}" is not a chat model (${capabilities.note ?? "no chat support"}). ` +
        `Structured generation needs a /chat/completions model.`,
      details: { model: input.model },
    });
  }

  const allowed = input.allow ?? STRATEGY_PRECEDENCE;
  const ladder = STRATEGY_PRECEDENCE.filter(
    (strategy) => allowed.includes(strategy) && supports(capabilities, strategy),
  );

  if (input.force) {
    if (!supports(capabilities, input.force)) {
      throw new RelaxUIError({
        code: "capability_unsupported",
        message:
          `Strategy "${input.force}" was forced but model "${input.model}" is not believed to ` +
          `support it. Override the capability registry if you know better.`,
        strategy: input.force,
        details: { model: input.model },
      });
    }
    return { strategy: input.force, fallbacks: [], capabilities };
  }

  const [strategy, ...fallbacks] = ladder;
  if (!strategy) {
    throw new RelaxUIError({
      code: "capability_unsupported",
      message: `No structuring strategy is both allowed and supported for "${input.model}".`,
      details: { model: input.model, allowed: [...allowed] },
    });
  }

  return { strategy, fallbacks, capabilities };
}

/**
 * Decides whether an error means "this server cannot do that" (so: downgrade and
 * retry) or "the request was wrong" (so: surface it).
 *
 * OpenAI-compatible servers are inconsistent here — some 400, some 422, some
 * return a 200 with an apology in the content — so we match on the message as
 * well as the status. Matching text is unlovely, but silently failing on
 * `response_format` is worse.
 */
export function isCapabilityRejection(
  error: unknown,
  strategy: StructuringStrategyName,
): boolean {
  if (!(error instanceof RelaxUIError)) return false;
  if (error.status !== 400 && error.status !== 404 && error.status !== 422 && error.status !== 501) {
    return false;
  }

  const message = error.message.toLowerCase();
  const generic =
    message.includes("not supported") ||
    message.includes("unsupported") ||
    message.includes("not implemented") ||
    message.includes("unrecognized") ||
    message.includes("unknown field") ||
    message.includes("invalid_request_error");

  if (strategy === "native_json_schema") {
    return generic || message.includes("response_format") || message.includes("json_schema") || message.includes("guided");
  }
  if (strategy === "tool_call") {
    return generic || message.includes("tool") || message.includes("function");
  }
  return false;
}
