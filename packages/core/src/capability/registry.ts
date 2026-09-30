import type { StructuringStrategyName } from "../types.js";

/**
 * What a relaxAI model can actually be relied on to do.
 *
 * relaxAI is 1:1 OpenAI-compatible at the *protocol* level, which is a gift —
 * every OpenAI client just works. But protocol compatibility is not capability
 * parity: the catalogue is open-weight models (Llama 4, DeepSeek, GPT-OSS,
 * GLM), and constrained decoding, tool calling and reasoning-trace behaviour
 * differ per family. A client that assumes `response_format.json_schema` works
 * everywhere will fail in production on exactly the models a UK enterprise
 * picked relaxAI to get.
 *
 * So capability is data, not an assumption. Entries here are the SDK's *prior*;
 * {@link negotiateStrategy} refines them against what the server actually did.
 */
export interface ModelCapabilities {
  /** Honours `response_format: { type: "json_schema", ... }` with real constrained decoding. */
  jsonSchema: boolean;
  /** Honours `response_format: { type: "json_object" }`. */
  jsonObject: boolean;
  /** Honours `tools` + `tool_choice`. */
  toolCalling: boolean;
  /** Supports `stream: true` with SSE deltas. */
  streaming: boolean;
  /**
   * Emits a chain-of-thought preamble (DeepSeek R1's `<think>`, GPT-OSS's
   * harmony channels) that must be stripped before JSON parsing.
   */
  reasoningTrace: boolean;
  /** Advertised context window in tokens, for budget checks. Best known value. */
  contextWindow?: number;
  /** Set for embedding-only models so callers fail fast rather than at request time. */
  chatCapable: boolean;
  /** Free-text provenance so an operator can see where a claim came from. */
  note?: string;
}

export const UNKNOWN_MODEL_CAPABILITIES: ModelCapabilities = {
  // Pessimistic on purpose: an unknown model gets the strategy that works on
  // every OpenAI-compatible server, and gets promoted once probing proves more.
  jsonSchema: false,
  jsonObject: true,
  toolCalling: false,
  streaming: true,
  reasoningTrace: false,
  chatCapable: true,
  note: "Unrecognised model id; conservative defaults applied.",
};

interface CapabilityRule {
  /** Matched case-insensitively against the model id. */
  match: RegExp;
  capabilities: ModelCapabilities;
}

/**
 * Ordered most-specific-first. Patterns rather than exact ids because relaxAI
 * versions model names (`DeepSeek-V31-Terminus`, `DeepSeek-V4-Pro`) and we would
 * rather degrade to the family default than to "unknown".
 */
const RULES: readonly CapabilityRule[] = [
  {
    // `embed` rather than `embedding`, so Ollama-style names (nomic-embed-text,
    // mxbai-embed-large) are caught too — they are the ones most likely to turn
    // up in a `/models` listing next to chat models.
    match: /embed|rerank/i,
    capabilities: {
      jsonSchema: false, jsonObject: false, toolCalling: false, streaming: false,
      reasoningTrace: false, chatCapable: false,
      note: "Embedding or rerank model: not valid for /chat/completions.",
    },
  },
  {
    match: /^deepseek-r1/i,
    capabilities: {
      jsonSchema: false, jsonObject: true, toolCalling: false, streaming: true,
      reasoningTrace: true, contextWindow: 128_000, chatCapable: true,
      note: "R1 emits <think> before the answer; tool calling is unreliable.",
    },
  },
  {
    match: /^deepseek-v4/i,
    capabilities: {
      jsonSchema: true, jsonObject: true, toolCalling: true, streaming: true,
      reasoningTrace: true, contextWindow: 1_049_000, chatCapable: true,
      note: "Frontier MoE; long context, strong tool use, reasoning preamble possible.",
    },
  },
  {
    match: /^deepseek/i,
    capabilities: {
      jsonSchema: false, jsonObject: true, toolCalling: true, streaming: true,
      reasoningTrace: true, contextWindow: 128_000, chatCapable: true,
      note: "DeepSeek V3 family default.",
    },
  },
  {
    match: /^glm/i,
    capabilities: {
      jsonSchema: true, jsonObject: true, toolCalling: true, streaming: true,
      reasoningTrace: true, contextWindow: 200_000, chatCapable: true,
      note: "GLM 4.6: built for agentic/tool-calling workloads.",
    },
  },
  {
    match: /^gpt-oss/i,
    capabilities: {
      jsonSchema: false, jsonObject: true, toolCalling: true, streaming: true,
      reasoningTrace: true, contextWindow: 128_000, chatCapable: true,
      note: "Harmony response format: reasoning channel must be stripped.",
    },
  },
  {
    match: /^llama-4-maverick/i,
    capabilities: {
      jsonSchema: false, jsonObject: true, toolCalling: true, streaming: true,
      reasoningTrace: false, contextWindow: 500_000, chatCapable: true,
      note: "Tool calling is the reliable structuring path for Llama 4 Maverick.",
    },
  },
  {
    match: /^llama-4/i,
    capabilities: {
      jsonSchema: false, jsonObject: true, toolCalling: true, streaming: true,
      reasoningTrace: false, contextWindow: 320_000, chatCapable: true,
      note: "Llama 4 family default (Scout and siblings).",
    },
  },
  {
    match: /^llama-3/i,
    capabilities: {
      jsonSchema: false, jsonObject: true, toolCalling: true, streaming: true,
      reasoningTrace: false, contextWindow: 128_000, chatCapable: true,
      note: "Llama 3.x: tool calling supported, no constrained decoding.",
    },
  },
  {
    match: /^kimi/i,
    capabilities: {
      jsonSchema: false, jsonObject: true, toolCalling: true, streaming: true,
      reasoningTrace: false, contextWindow: 128_000, chatCapable: true,
      note: "Kimi family default.",
    },
  },
  // --- families as named by local runtimes (Ollama tags like `qwen2.5:7b`) ----
  // These are priors, not measurements, exactly like the relaxAI entries above:
  // a local runtime's tool support depends on both the model's template and the
  // server version. `pnpm probe --base-url http://localhost:11434/v1
  // --allow-insecure-loopback` measures them and prints a seed to paste back.
  {
    match: /^qwen3/i,
    capabilities: {
      jsonSchema: false, jsonObject: true, toolCalling: true, streaming: true,
      reasoningTrace: true, contextWindow: 32_000, chatCapable: true,
      note: "Qwen3: ships tool templates and a thinking mode. Prior, unverified.",
    },
  },
  {
    match: /^qwen/i,
    capabilities: {
      jsonSchema: false, jsonObject: true, toolCalling: true, streaming: true,
      reasoningTrace: false, contextWindow: 32_000, chatCapable: true,
      note: "Qwen2.x: tool templates present. Prior, unverified.",
    },
  },
  {
    // Ollama-style tag (`llama3.2:3b`); the hyphenated `llama-3` rule above
    // covers hosted naming.
    match: /^llama3[.:]/i,
    capabilities: {
      jsonSchema: false, jsonObject: true, toolCalling: true, streaming: true,
      reasoningTrace: false, contextWindow: 128_000, chatCapable: true,
      note: "Llama 3.x served locally. Tool support from 3.1 onward. Prior, unverified.",
    },
  },
  {
    match: /^gemma/i,
    capabilities: {
      jsonSchema: false, jsonObject: true, toolCalling: false, streaming: true,
      reasoningTrace: false, contextWindow: 8_000, chatCapable: true,
      note: "Gemma: most builds ship no tool template, so the prompted floor applies.",
    },
  },
  {
    match: /^mistral/i,
    capabilities: {
      jsonSchema: false, jsonObject: true, toolCalling: true, streaming: true,
      reasoningTrace: false, contextWindow: 32_000, chatCapable: true,
      note: "Mistral chat models.",
    },
  },
];

/**
 * Mutable capability store.
 *
 * Runtime observations (a 400 saying `response_format` is unsupported, a
 * successful tool call) are written back here so the second request in a process
 * does not repeat the first one's mistake.
 */
export class CapabilityRegistry {
  private readonly overrides = new Map<string, Partial<ModelCapabilities>>();

  constructor(seed?: Record<string, Partial<ModelCapabilities>>) {
    if (seed) for (const [model, caps] of Object.entries(seed)) this.overrides.set(model.toLowerCase(), caps);
  }

  /** Static prior for `model`, before any overrides. */
  static baseline(model: string): ModelCapabilities {
    const id = model.trim();
    for (const rule of RULES) {
      if (rule.match.test(id)) return { ...rule.capabilities };
    }
    return { ...UNKNOWN_MODEL_CAPABILITIES };
  }

  get(model: string): ModelCapabilities {
    const base = CapabilityRegistry.baseline(model);
    const override = this.overrides.get(model.toLowerCase());
    return override ? { ...base, ...override } : base;
  }

  /** Records an observation. Merges, so unrelated flags are preserved. */
  observe(model: string, patch: Partial<ModelCapabilities>): void {
    const key = model.toLowerCase();
    this.overrides.set(key, { ...this.overrides.get(key), ...patch });
  }

  /** Marks a structuring strategy as proven unsupported for `model`. */
  markStrategyUnsupported(model: string, strategy: StructuringStrategyName): void {
    if (strategy === "native_json_schema") this.observe(model, { jsonSchema: false });
    else if (strategy === "tool_call") this.observe(model, { toolCalling: false });
    // `prompted_json` is the floor: there is nothing below it to fall back to.
  }

  snapshot(): Record<string, Partial<ModelCapabilities>> {
    return Object.fromEntries(this.overrides);
  }
}

/** Process-wide default so independent call sites share what they learn. */
export const defaultCapabilityRegistry = new CapabilityRegistry();
