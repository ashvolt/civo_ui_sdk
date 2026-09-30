import { describe, expect, it, vi } from "vitest";
import { parseParamCount, rankOllamaModels, resolveProviderId } from "../app/provider";

/**
 * Which local model the demo picks.
 *
 * Worth testing despite living in an example: the ordering decides what a
 * reviewer sees on first run, and getting it wrong is the difference between
 * "the layout streams in" and "my laptop swapped for two minutes". The first
 * cut ranked by model family and would happily have chosen a 32b over a 7b.
 */
describe("parseParamCount", () => {
  it("reads a plain size tag", () => {
    expect(parseParamCount("qwen2.5:7b")).toBe(7);
    expect(parseParamCount("qwen3:4b")).toBe(4);
    expect(parseParamCount("qwen3:0.6b")).toBe(0.6);
  });

  it("ignores quantisation and instruct suffixes", () => {
    expect(parseParamCount("llama3.2:3b-instruct-q4_K_M")).toBe(3);
  });

  it("takes an MoE's total rather than its active experts", () => {
    // `30b-a3b` is a 30b model that activates 3b. Reading the 3b would make it
    // look laptop-sized when it needs 30b of memory.
    expect(parseParamCount("qwen3:30b-a3b")).toBe(30);
  });

  it("multiplies out an NxM mixture", () => {
    // mixtral:8x7b is ~56b, not 7b — the trap this exists to avoid.
    expect(parseParamCount("mixtral:8x7b")).toBe(56);
  });

  it("returns undefined when the tag says nothing about size", () => {
    expect(parseParamCount("llama3.2:latest")).toBeUndefined();
    expect(parseParamCount("gemma2")).toBeUndefined();
  });
});

describe("rankOllamaModels", () => {
  const pick = (ids: string[]) => rankOllamaModels(ids)[0];

  it("prefers a small model over a large one", () => {
    expect(pick(["qwen3:32b", "qwen2.5:7b"])).toBe("qwen2.5:7b");
    expect(pick(["llama3.3:70b", "qwen3:4b"])).toBe("qwen3:4b");
    expect(pick(["mixtral:8x7b", "qwen2.5:7b"])).toBe("qwen2.5:7b");
  });

  it("prefers the smaller of two models inside the usable band", () => {
    // Both straight-answering and tool-capable, so only size separates them.
    expect(pick(["qwen2.5:7b", "qwen2.5:3b"])).toBe("qwen2.5:3b");
    expect(pick(["nomic-embed-text:latest", "qwen2.5:7b", "llama3.2:3b"])).toBe("llama3.2:3b");
  });

  it("does not go so small that the model cannot manage a nested schema", () => {
    // A 0.6b model will not reliably emit a component tree through a tool call,
    // and picking it by default would make the SDK look like what broke.
    expect(pick(["qwen3:0.6b", "llama3.2:3b"])).toBe("llama3.2:3b");
  });

  it("prefers tool capability over a smaller model that lacks it", () => {
    // Being smaller is only better if the model can still reach the same tier;
    // gemma ships no tool template in most builds.
    expect(pick(["gemma2:2b", "qwen2.5:7b"])).toBe("qwen2.5:7b");
    expect(pick(["gemma2:4b", "qwen3:4b"])).toBe("qwen3:4b");
  });

  it("prefers a straight-answering model over a reasoning one of the same size", () => {
    // qwen3 thinks before answering; qwen2.5 does not. Same band, both
    // tool-capable, so the only difference is how long the demo takes —
    // measured at nine minutes versus seconds on the same machine.
    expect(pick(["qwen3:4b", "qwen2.5:7b"])).toBe("qwen2.5:7b");
    expect(pick(["qwen3:4b", "llama3.2:3b"])).toBe("llama3.2:3b");
  });

  it("still takes a reasoning model over one that cannot call tools", () => {
    // Tool capability decides which tier the demo shows; reasoning only how
    // long it takes to show it.
    expect(pick(["qwen3:4b", "gemma2:4b"])).toBe("qwen3:4b");
  });

  it("falls back rather than refusing when only awkward options exist", () => {
    expect(pick(["qwen3:0.6b"])).toBe("qwen3:0.6b");
    expect(pick(["llama3.3:70b"])).toBe("llama3.3:70b");
    // An unlabelled tag is a better bet than a known-huge one.
    expect(pick(["llama3.2:latest", "qwen3:32b"])).toBe("llama3.2:latest");
  });

  it("is a total order, so the pick is stable across listings", () => {
    const ids = ["qwen2.5:7b", "llama3.2:3b", "gemma2:9b", "qwen3:32b"];
    const forward = rankOllamaModels(ids);
    const reversed = rankOllamaModels([...ids].reverse());
    expect(forward).toEqual(reversed);
  });
});

describe("resolveProviderId", () => {
  const withEnv = <T>(value: string | undefined, fn: () => T): T => {
    const previous = process.env["RELAX_UI_PROVIDER"];
    if (value === undefined) delete process.env["RELAX_UI_PROVIDER"];
    else process.env["RELAX_UI_PROVIDER"] = value;
    try {
      return fn();
    } finally {
      if (previous === undefined) delete process.env["RELAX_UI_PROVIDER"];
      else process.env["RELAX_UI_PROVIDER"] = previous;
    }
  };

  it("defaults to relaxAI when unset", () => {
    expect(withEnv(undefined, resolveProviderId)).toBe("relaxai");
  });

  it("accepts the documented values", () => {
    expect(withEnv("ollama", resolveProviderId)).toBe("ollama");
    expect(withEnv("relaxai", resolveProviderId)).toBe("relaxai");
  });

  it("is case- and whitespace-insensitive", () => {
    // `Ollama` used to fall through to relaxAI in silence, which then failed
    // with a missing-key error pointing nowhere near the actual mistake.
    for (const value of ["Ollama", "OLLAMA", " ollama ", "local"]) {
      expect(withEnv(value, resolveProviderId)).toBe("ollama");
    }
  });

  it("warns rather than silently defaulting on an unrecognised value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(withEnv("olama", resolveProviderId)).toBe("relaxai");
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]?.[0])).toContain("olama");
    } finally {
      warn.mockRestore();
    }
  });
});
