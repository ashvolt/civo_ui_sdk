import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityRegistry, capabilityRegistryFor } from "../src/capability/registry.js";
import { createClient, OpenAICompatibleClient } from "../src/client/openai-compatible-client.js";
import { RelaxClient } from "../src/client/relax-client.js";
import { RelaxUIError } from "../src/errors.js";
import {
  BUILT_IN_PROVIDERS,
  defineProvider,
  LOOPBACK_ONLY_POLICY,
  ollama,
  relaxai,
  resolveProvider,
} from "../src/provider/profile.js";
import { parseParamCount, pickChatModel, rankChatModels } from "../src/provider/model-selection.js";
import { completion, stubFetch } from "./helpers.js";

/**
 * The provider layer (feature 002).
 *
 * Most of what is asserted here is a *refusal*. Making the endpoint selectable
 * is only acceptable if it cannot be selected by accident, cannot be widened by
 * an environment variable, and cannot be mistaken for the sovereign one — so
 * those are the properties with tests, rather than "Ollama works".
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof RelaxUIError ? error.code : `not a RelaxUIError: ${String(error)}`;
  }
  return undefined;
}

describe("resolveProvider", () => {
  it("knows the built-in providers", () => {
    expect(Object.keys(BUILT_IN_PROVIDERS).sort()).toEqual(["llamacpp", "lmstudio", "ollama", "relaxai"]);
    expect(resolveProvider("ollama")).toBe(ollama);
  });

  it("is forgiving about case and the names people actually type", () => {
    expect(resolveProvider("Ollama")).toBe(ollama);
    expect(resolveProvider("  RELAXAI ")).toBe(relaxai);
    expect(resolveProvider("local")).toBe(ollama);
    expect(resolveProvider("lm-studio").id).toBe("lmstudio");
    expect(resolveProvider("llama.cpp").id).toBe("llamacpp");
  });

  it("refuses an unknown name instead of falling back to the default", () => {
    // The regression this pins: feature 001's example warned and used relaxAI,
    // which is a typo that sends prompts somewhere nobody chose.
    expect(codeOf(() => resolveProvider("olama"))).toBe("config_invalid");
    try {
      resolveProvider("olama");
    } catch (error) {
      expect((error as Error).message).toContain("olama");
      expect((error as Error).message).toContain("ollama");
      expect((error as Error).message).toContain("relaxai");
    }
  });

  it("accepts a profile the application defined itself", () => {
    const gateway = defineProvider({
      id: "eu-gateway",
      label: "EU gateway",
      baseURL: "https://llm.internal.example/v1",
      requiresApiKey: true,
      apiKeyEnv: ["GATEWAY_KEY"],
      egress: { allowedHosts: ["llm.internal.example"] },
      sovereign: false,
      local: false,
    });
    expect(resolveProvider(gateway).id).toBe("eu-gateway");
  });
});

describe("defineProvider", () => {
  const base = {
    label: "X",
    baseURL: "https://x.example/v1",
    requiresApiKey: false,
    egress: { allowedHosts: ["x.example"] },
    sovereign: false,
    local: false,
  };

  it("rejects an id that could not travel on the wire", () => {
    expect(codeOf(() => defineProvider({ ...base, id: "Has Spaces" }))).toBe("config_invalid");
    expect(codeOf(() => defineProvider({ ...base, id: "" }))).toBe("config_invalid");
    expect(codeOf(() => defineProvider({ ...base, id: "9lives" }))).toBe("config_invalid");
  });

  it("rejects a base URL that is not absolute", () => {
    expect(codeOf(() => defineProvider({ ...base, id: "x", baseURL: "/v1" }))).toBe("config_invalid");
  });

  it("will not let a profile claim sovereignty and permit plaintext", () => {
    expect(
      codeOf(() =>
        defineProvider({ ...base, id: "x", sovereign: true, egress: { ...LOOPBACK_ONLY_POLICY } }),
      ),
    ).toBe("config_invalid");
  });

  it("freezes the profile", () => {
    const profile = defineProvider({ ...base, id: "x" });
    expect(Object.isFrozen(profile)).toBe(true);
  });
});

describe("the built-in profiles", () => {
  it("only relaxAI claims to be sovereign", () => {
    for (const profile of Object.values(BUILT_IN_PROVIDERS)) {
      expect(profile.sovereign, profile.id).toBe(profile.id === "relaxai");
    }
  });

  it("every local profile allowlists loopback hosts and nothing else", () => {
    for (const profile of Object.values(BUILT_IN_PROVIDERS)) {
      if (!profile.local) continue;
      expect(new URL(profile.baseURL).hostname, profile.id).toBe("127.0.0.1");
      expect([...(profile.egress.allowedHosts ?? [])].sort(), profile.id).toEqual(
        ["127.0.0.1", "[::1]", "localhost"].sort(),
      );
    }
  });

  it("relaxAI permits no plaintext and requires a key", () => {
    expect(relaxai.egress.allowInsecureTransport).not.toBe(true);
    expect(relaxai.requiresApiKey).toBe(true);
    expect(relaxai.egress.allowedHosts).toEqual(["api.relax.ai"]);
  });
});

describe("OpenAICompatibleClient", () => {
  it("defaults to relaxAI, with relaxAI's allowlist and key requirement", () => {
    vi.stubEnv("RELAX_API_KEY", "");
    vi.stubEnv("RELAXAI_API_KEY", "");
    expect(codeOf(() => new OpenAICompatibleClient())).toBe("config_invalid");

    const client = new OpenAICompatibleClient({ apiKey: "k" });
    expect(client.provider).toEqual({ id: "relaxai", label: "relaxAI", sovereign: true, local: false });
    expect(client.baseURL.host).toBe("api.relax.ai");
  });

  it("builds an Ollama client with no API key at all", () => {
    vi.stubEnv("OLLAMA_API_KEY", "");
    const client = new OpenAICompatibleClient({ provider: "ollama" });
    expect(client.provider).toEqual({ id: "ollama", label: "Ollama", sovereign: false, local: true });
    expect(client.baseURL.href).toBe("http://127.0.0.1:11434/v1");
  });

  it("sends no Authorization header for a keyless provider", async () => {
    vi.stubEnv("OLLAMA_API_KEY", "");
    const stub = stubFetch([{ json: completion("{}") }]);
    const client = new OpenAICompatibleClient({ provider: "ollama", fetch: stub.fetch });
    await client.chatCompletion({ model: "qwen2.5:7b", messages: [{ role: "user", content: "hi" }] });

    expect(stub.requests[0]?.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(Object.keys(stub.requests[0]?.headers ?? {})).not.toContain("Authorization");
  });

  it("still sends a key to a keyless provider when one is supplied", async () => {
    // A local runtime behind an authenticating proxy is a real deployment.
    const stub = stubFetch([{ json: completion("{}") }]);
    const client = new OpenAICompatibleClient({ provider: "ollama", apiKey: "proxy-token", fetch: stub.fetch });
    await client.chatCompletion({ model: "qwen2.5:7b", messages: [{ role: "user", content: "hi" }] });
    expect(stub.requests[0]?.headers["Authorization"]).toBe("Bearer proxy-token");
  });

  it("refuses to point a local provider at a remote host", () => {
    expect(
      codeOf(() => new OpenAICompatibleClient({ provider: "ollama", baseURL: "https://ollama.example.com/v1" })),
    ).toBe("sovereignty_violation");
    // And not in the clear either — which is the dangerous one.
    expect(
      codeOf(() => new OpenAICompatibleClient({ provider: "ollama", baseURL: "http://10.0.0.5:11434/v1" })),
    ).toBe("sovereignty_violation");
  });

  it("does not let an environment variable widen a local provider's allowlist", () => {
    // FR-107. The base URL may come from the environment; who may be dialled
    // may not.
    vi.stubEnv("OLLAMA_BASE_URL", "http://gpu-box.internal:11434/v1");
    expect(codeOf(() => new OpenAICompatibleClient({ provider: "ollama" }))).toBe("sovereignty_violation");
  });

  it("reads the base URL from the provider's own environment variable", () => {
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11500/v1");
    expect(new OpenAICompatibleClient({ provider: "ollama" }).baseURL.host).toBe("localhost:11500");
  });

  it("allows a wider allowlist only as an explicit client option", () => {
    const client = new OpenAICompatibleClient({
      provider: "ollama",
      baseURL: "https://gpu-box.internal/v1",
      sovereignty: { allowedHosts: ["gpu-box.internal"] },
    });
    expect(client.baseURL.host).toBe("gpu-box.internal");
    // Widening the allowlist does not make the provider sovereign.
    expect(client.provider.sovereign).toBe(false);
  });

  it("names the provider, not relaxAI, when the endpoint fails", async () => {
    const stub = stubFetch([{ status: 500, json: { error: { message: "model runner crashed" } } }]);
    const client = new OpenAICompatibleClient({
      provider: "ollama",
      fetch: stub.fetch,
      retry: { maxRetries: 0 },
    });
    await expect(
      client.chatCompletion({ model: "qwen2.5:7b", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/Ollama returned 500/);
  });
});

describe("RelaxClient", () => {
  it("is the relaxAI provider and cannot be redirected by RELAX_UI_PROVIDER", () => {
    vi.stubEnv("RELAX_UI_PROVIDER", "ollama");
    const client = new RelaxClient({ apiKey: "k" });
    expect(client.provider.id).toBe("relaxai");
    expect(client.baseURL.host).toBe("api.relax.ai");
  });

  it("is still an OpenAICompatibleClient, so feature-001 code keeps working", () => {
    expect(new RelaxClient({ apiKey: "k" })).toBeInstanceOf(OpenAICompatibleClient);
  });
});

describe("createClient", () => {
  it("uses relaxAI when nothing names a provider", () => {
    vi.stubEnv("RELAX_UI_PROVIDER", "");
    expect(createClient({ apiKey: "k" }).provider.id).toBe("relaxai");
  });

  it("takes the provider from RELAX_UI_PROVIDER", () => {
    vi.stubEnv("RELAX_UI_PROVIDER", "Ollama");
    expect(createClient().provider.id).toBe("ollama");
  });

  it("lets an explicit option beat the environment", () => {
    vi.stubEnv("RELAX_UI_PROVIDER", "ollama");
    expect(createClient({ provider: "relaxai", apiKey: "k" }).provider.id).toBe("relaxai");
  });

  it("throws on a misspelt RELAX_UI_PROVIDER rather than using relaxAI", () => {
    vi.stubEnv("RELAX_UI_PROVIDER", "olama");
    vi.stubEnv("RELAX_API_KEY", "a-real-key-that-must-not-be-used");
    expect(codeOf(() => createClient())).toBe("config_invalid");
  });
});

describe("capability is scoped to the endpoint", () => {
  it("lets a provider refine a chat model's prior", () => {
    // Measured: Ollama constrains decoding server-side, whatever the model.
    expect(CapabilityRegistry.baseline("qwen2.5:7b").jsonSchema).toBe(false);
    const client = new OpenAICompatibleClient({ provider: "ollama" });
    expect(client.capabilitiesFor("qwen2.5:7b").jsonSchema).toBe(true);
    expect(client.capabilitiesFor("some-model-nobody-has-heard-of").jsonSchema).toBe(true);
  });

  it("never lets that refinement make an embeddings model chat-capable", () => {
    const client = new OpenAICompatibleClient({ provider: "ollama" });
    const caps = client.capabilitiesFor("nomic-embed-text:latest");
    expect(caps.chatCapable).toBe(false);
    expect(caps.jsonSchema).toBe(false);
  });

  it("puts an observation above the provider's refinement", () => {
    const registry = new CapabilityRegistry(undefined, { endpointDefaults: { jsonSchema: true } });
    registry.markStrategyUnsupported("qwen2.5:7b", "native_json_schema");
    expect(registry.get("qwen2.5:7b").jsonSchema).toBe(false);
    expect(registry.get("qwen2.5:3b").jsonSchema).toBe(true);
  });

  it("shares what is learned between clients of the same endpoint", () => {
    const a = new OpenAICompatibleClient({ provider: "ollama", baseURL: "http://127.0.0.1:21001/v1" });
    const b = new OpenAICompatibleClient({ provider: "ollama", baseURL: "http://127.0.0.1:21001/v1" });
    a.capabilities.markStrategyUnsupported("m", "tool_call");
    expect(b.capabilitiesFor("m").toolCalling).toBe(false);
  });

  it("does not carry it to a different endpoint serving the same model name", () => {
    const here = new OpenAICompatibleClient({ provider: "ollama", baseURL: "http://127.0.0.1:21002/v1" });
    const there = new OpenAICompatibleClient({ provider: "ollama", baseURL: "http://127.0.0.1:21003/v1" });
    const hosted = new RelaxClient({ apiKey: "k" });

    here.capabilities.markStrategyUnsupported("qwen2.5:7b", "tool_call");

    expect(here.capabilitiesFor("qwen2.5:7b").toolCalling).toBe(false);
    expect(there.capabilitiesFor("qwen2.5:7b").toolCalling).toBe(true);
    expect(hosted.capabilitiesFor("qwen2.5:7b").toolCalling).toBe(true);
  });

  it("does not let a local provider's refinement leak into relaxAI's registry", () => {
    new OpenAICompatibleClient({ provider: "ollama" });
    expect(new RelaxClient({ apiKey: "k" }).capabilitiesFor("qwen2.5:7b").jsonSchema).toBe(false);
  });

  it("returns the same registry for the same scope", () => {
    expect(capabilityRegistryFor("test-scope-a")).toBe(capabilityRegistryFor("test-scope-a"));
    expect(capabilityRegistryFor("test-scope-a")).not.toBe(capabilityRegistryFor("test-scope-b"));
  });
});

describe("choosing a local model", () => {
  it("reads a parameter count from an Ollama-style tag", () => {
    expect(parseParamCount("qwen2.5:7b")).toBe(7);
    expect(parseParamCount("qwen3:30b-a3b")).toBe(30);
    expect(parseParamCount("mixtral:8x7b")).toBe(56);
    expect(parseParamCount("llama3.2:latest")).toBeUndefined();
  });

  it("never offers an embeddings model as a chat model", () => {
    // Feature 001's ranking sorted these last; with nothing else installed it
    // would still have picked one.
    expect(rankChatModels(["nomic-embed-text:latest", "mxbai-embed-large"])).toEqual([]);
    expect(pickChatModel(["nomic-embed-text:latest"])).toBeUndefined();
  });

  it("picks from a real `ollama list`", () => {
    const installed = [
      "qwen2.5:3b",
      "qwen3:4b",
      "qwen2.5:14b",
      "qwen2.5:7b",
      "nomic-embed-text:latest",
      "llama3.2:3b",
      "llama3.2:1b",
    ];
    const ranked = rankChatModels(installed);
    expect(ranked).not.toContain("nomic-embed-text:latest");
    // Small, straight-answering models first; the reasoning 4b behind the 7b;
    // the 1b and the 14b at the back.
    expect(ranked.slice(0, 2).sort()).toEqual(["llama3.2:3b", "qwen2.5:3b"]);
    expect(ranked.indexOf("qwen2.5:7b")).toBeLessThan(ranked.indexOf("qwen3:4b"));
    expect(ranked.at(-1)).toBe("qwen2.5:14b");
  });
});
