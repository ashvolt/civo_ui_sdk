import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CapabilityRegistry } from "../src/capability/registry.js";
import { generateObject, streamObject } from "../src/generate.js";
import { UIStreamAccumulator, type UIStreamEvent } from "../src/protocol.js";
import { defineStructuredSchema } from "../src/schema/define.js";
import type { ChatCompletionRequest, StructuringStrategyName } from "../src/types.js";
import {
  completion,
  contentChunks,
  errorBody,
  stubFetch,
  testClient,
  toolChunks,
  toolCompletion,
} from "./helpers.js";

const Report = defineStructuredSchema({
  name: "Report",
  schema: z.object({ title: z.string(), score: z.number() }),
});

/** A model the registry believes supports every tier. */
const ALL_TIERS = new CapabilityRegistry({
  "test-model": { jsonSchema: true, toolCalling: true, jsonObject: true, streaming: true },
});

/** A model with no constrained decoding and no tools: the floor. */
const FLOOR_ONLY = new CapabilityRegistry({
  "test-model": { jsonSchema: false, toolCalling: false, jsonObject: true, streaming: true },
});

describe("generateObject", () => {
  it("returns a validated object via native json_schema when available", async () => {
    const stub = stubFetch([{ json: completion('{"title":"Q1","score":9}') }]);
    const result = await generateObject({
      client: testClient(stub, ALL_TIERS),
      model: "test-model",
      schema: Report,
      prompt: "summarise",
    });

    expect(result.object).toEqual({ title: "Q1", score: 9 });
    expect(result.metadata.strategy).toBe("native_json_schema");
    expect(result.metadata.repairAttempts).toBe(0);
    const sent = stub.requests[0]?.body as ChatCompletionRequest;
    expect(sent.response_format?.type).toBe("json_schema");
  });

  it("reads the object out of a tool call when that is the chosen tier", async () => {
    const stub = stubFetch([{ json: toolCompletion("Report", '{"title":"Q2","score":7}') }]);
    const result = await generateObject({
      client: testClient(stub, ALL_TIERS),
      model: "test-model",
      schema: Report,
      prompt: "summarise",
      forceStrategy: "tool_call",
    });

    expect(result.object).toEqual({ title: "Q2", score: 7 });
    const sent = stub.requests[0]?.body as ChatCompletionRequest;
    expect(sent.tools?.[0]?.function.name).toBe("Report");
    expect(sent.tool_choice).toEqual({ type: "function", function: { name: "Report" } });
  });

  it("downgrades when the server rejects response_format, and remembers", async () => {
    const registry = new CapabilityRegistry({
      "test-model": { jsonSchema: true, toolCalling: true, jsonObject: true, streaming: true },
    });
    const stub = stubFetch([
      { status: 400, json: errorBody("response_format json_schema is not supported by this model") },
      { json: toolCompletion("Report", '{"title":"Q3","score":5}') },
    ]);

    const downgrades: string[] = [];
    const result = await generateObject({
      client: testClient(stub, registry),
      model: "test-model",
      schema: Report,
      prompt: "summarise",
      onEvent: (event) => {
        if (event.type === "strategy_downgraded") downgrades.push(`${event.from}->${event.to}`);
      },
    });

    expect(result.object.title).toBe("Q3");
    expect(result.metadata.strategy).toBe("tool_call");
    expect(result.metadata.downgradedFrom).toEqual(["native_json_schema"]);
    expect(downgrades).toEqual(["native_json_schema->tool_call"]);
    // The capability was learned, so the next call skips the dead tier.
    expect(registry.get("test-model").jsonSchema).toBe(false);
  });

  it("strips reasoning traces and markdown fences before parsing", async () => {
    const registry = new CapabilityRegistry({
      "test-model": { jsonSchema: false, toolCalling: false, jsonObject: true, reasoningTrace: true },
    });
    const messy = '<think>Let me consider the shape...</think>\nHere you go:\n```json\n{"title":"Q4","score":3}\n```\nHope that helps!';
    const stub = stubFetch([{ json: completion(messy) }]);

    const result = await generateObject({
      client: testClient(stub, registry),
      model: "test-model",
      schema: Report,
      prompt: "summarise",
    });
    expect(result.object).toEqual({ title: "Q4", score: 3 });
  });

  it("re-asks with the validation errors when the shape is wrong", async () => {
    const stub = stubFetch([
      { json: completion('{"title":"Q1","score":"nine"}') },
      { json: completion('{"title":"Q1","score":9}') },
    ]);
    const attempts: number[] = [];

    const result = await generateObject({
      client: testClient(stub, FLOOR_ONLY),
      model: "test-model",
      schema: Report,
      prompt: "summarise",
      maxRepairAttempts: 1,
      onEvent: (event) => {
        if (event.type === "repair_attempt") attempts.push(event.attempt);
      },
    });

    expect(result.object.score).toBe(9);
    expect(result.metadata.repairAttempts).toBe(1);
    expect(attempts).toEqual([1]);

    // The repair turn must show the model its own output and the specific errors.
    const repairMessages = (stub.requests[1]?.body as ChatCompletionRequest).messages;
    expect(repairMessages.at(-2)?.role).toBe("assistant");
    expect(repairMessages.at(-1)?.content).toContain("score");
  });

  it("gives up with a typed error rather than returning an unvalidated object", async () => {
    const stub = stubFetch([
      { json: completion('{"title":"Q1","score":"nine"}') },
      { json: completion('{"title":"Q1","score":"still not a number"}') },
    ]);

    await expect(
      generateObject({
        client: testClient(stub, FLOOR_ONLY),
        model: "test-model",
        schema: Report,
        prompt: "summarise",
        maxRepairAttempts: 1,
      }),
    ).rejects.toMatchObject({ code: "schema_violation" });
  });

  it("refuses an embeddings-only model before spending a request", async () => {
    const stub = stubFetch([{ json: completion("{}") }]);
    await expect(
      generateObject({
        client: testClient(stub),
        model: "Mistral-7b-embedding",
        schema: Report,
        prompt: "summarise",
      }),
    ).rejects.toMatchObject({ code: "capability_unsupported" });
    expect(stub.requests).toHaveLength(0);
  });
});

async function collect<T>(
  events: AsyncGenerator<UIStreamEvent<T>, void, unknown>,
): Promise<UIStreamEvent<T>[]> {
  const out: UIStreamEvent<T>[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("streamObject", () => {
  it("emits meta, ordered patches and a validated complete frame", async () => {
    const doc = '{"title":"Quarterly","score":42}';
    const stub = stubFetch([{ sse: contentChunks(doc, 6) }]);

    const events = await collect(
      streamObject({
        client: testClient(stub, ALL_TIERS),
        model: "test-model",
        schema: Report,
        prompt: "summarise",
      }),
    );

    expect(events[0]).toMatchObject({ type: "meta", schema: "Report", protocol: 1 });
    const terminal = events.at(-1);
    expect(terminal).toMatchObject({ type: "complete", value: { title: "Quarterly", score: 42 } });

    // Replaying the frames must reproduce the document exactly.
    const accumulator = new UIStreamAccumulator();
    for (const event of events) accumulator.apply(event);
    expect(accumulator.current()).toEqual({ title: "Quarterly", score: 42 });
    expect(accumulator.done).toBe(true);

    const seqs = events.filter((e) => e.type === "patch" || e.type === "snapshot").map((e) => (e as { seq: number }).seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    expect(seqs.length).toBeGreaterThan(1);
  });

  it("streams tool-call arguments as well as content", async () => {
    const doc = '{"title":"Tooled","score":1}';
    const stub = stubFetch([{ sse: toolChunks("Report", doc, 5) }]);

    const events = await collect(
      streamObject({
        client: testClient(stub, ALL_TIERS),
        model: "test-model",
        schema: Report,
        prompt: "summarise",
        forceStrategy: "tool_call",
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "complete", value: { title: "Tooled", score: 1 } });
  });

  it("aborts mid-stream on a fatal type violation instead of finishing the generation", async () => {
    // `score` arrives as a string: no amount of further tokens can fix that.
    const doc = '{"title":"Bad","score":"not-a-number","extra":"lots and lots of wasted tokens"}';
    const stub = stubFetch([{ sse: contentChunks(doc, 4) }]);

    const events = await collect(
      streamObject({
        client: testClient(stub, ALL_TIERS),
        model: "test-model",
        schema: Report,
        prompt: "summarise",
      }),
    );

    const last = events.at(-1) as { type: string; error?: { code: string } };
    expect(last.type).toBe("error");
    expect(last.error?.code).toBe("schema_violation");
    expect(events.some((e) => e.type === "complete")).toBe(false);
  });

  it("tolerates missing required keys while the stream is open", async () => {
    // `score` is absent for most of the stream; that must not be treated as an error.
    const doc = '{"title":"Patience is a virtue and this is a long title","score":1}';
    const stub = stubFetch([{ sse: contentChunks(doc, 3) }]);

    const events = await collect(
      streamObject({
        client: testClient(stub, ALL_TIERS),
        model: "test-model",
        schema: Report,
        prompt: "summarise",
      }),
    );
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "complete" });
  });

  it("falls back to a batch generation when the model cannot stream", async () => {
    const registry = new CapabilityRegistry({
      "test-model": { streaming: false, jsonSchema: false, toolCalling: false, jsonObject: true },
    });
    const stub = stubFetch([{ json: completion('{"title":"Batch","score":2}') }]);

    const events = await collect(
      streamObject({
        client: testClient(stub, registry),
        model: "test-model",
        schema: Report,
        prompt: "summarise",
      }),
    );

    expect(events.map((e) => e.type)).toEqual(["meta", "snapshot", "complete"]);
    expect((stub.requests[0]?.body as ChatCompletionRequest).stream).toBe(false);
  });

  it("repairs off-stream when the stream ends short, then replaces the document", async () => {
    const stub = stubFetch([
      { sse: contentChunks('{"title":"Truncated"', 6) },
      { json: completion('{"title":"Truncated","score":4}') },
    ]);

    const events = await collect(
      streamObject({
        client: testClient(stub, ALL_TIERS),
        model: "test-model",
        schema: Report,
        prompt: "summarise",
      }),
    );

    expect(events.at(-2)).toMatchObject({ type: "snapshot" });
    expect(events.at(-1)).toMatchObject({ type: "complete", value: { title: "Truncated", score: 4 } });
  });

  it("reports transport failures as an error frame, not an exception", async () => {
    const stub = stubFetch([{ status: 500, json: errorBody("upstream exploded") }]);
    const events = await collect(
      streamObject({
        client: testClient(stub, ALL_TIERS),
        model: "test-model",
        schema: Report,
        prompt: "summarise",
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", error: { code: "http_error", retryable: true } });
  });

  it("coalesces frames under a throttle without losing the final document", async () => {
    const doc = '{"title":"Throttled and reasonably long","score":8}';
    const countFrames = async (frameIntervalMs: number) => {
      let clock = 0;
      const stub = stubFetch([{ sse: contentChunks(doc, 2) }]);
      const events = await collect(
        streamObject({
          client: testClient(stub, ALL_TIERS),
          model: "test-model",
          schema: Report,
          prompt: "summarise",
          frameIntervalMs,
          now: () => (clock += 100),
        }),
      );
      return {
        frames: events.filter((e) => e.type === "patch" || e.type === "snapshot").length,
        last: events.at(-1),
      };
    };

    const unthrottled = await countFrames(0);
    const throttled = await countFrames(1_000);

    expect(throttled.frames).toBeLessThan(unthrottled.frames);
    // Throttling is a bandwidth trade, never a correctness one: both runs must
    // still end on the same validated document.
    expect(throttled.last).toMatchObject({ type: "complete", value: { title: "Throttled and reasonably long", score: 8 } });
    expect(unthrottled.last).toMatchObject({ type: "complete", value: { title: "Throttled and reasonably long", score: 8 } });
  });
});

describe("capability priors for locally-served models", () => {
  it("treats an Ollama-style embedding name as not chat-capable", () => {
    // A `/models` listing from a local runtime mixes embedding models in with
    // chat models, and "nomic-embed-text" does not contain "embedding".
    for (const id of ["nomic-embed-text:latest", "mxbai-embed-large", "bge-reranker-v2"]) {
      expect(CapabilityRegistry.baseline(id).chatCapable).toBe(false);
    }
  });

  it("recognises Ollama-style chat tags rather than falling to the floor", () => {
    // `llama3.2:3b` is the same family as `Llama-3.3-70B` but spelled the way a
    // local runtime names it; without this the ladder starts at prompted_json.
    expect(CapabilityRegistry.baseline("llama3.2:3b").toolCalling).toBe(true);
    expect(CapabilityRegistry.baseline("qwen2.5:7b").toolCalling).toBe(true);
    expect(CapabilityRegistry.baseline("qwen3:8b").reasoningTrace).toBe(true);
    // Gemma ships no tool template in most builds, so the floor is correct.
    expect(CapabilityRegistry.baseline("gemma2:9b").toolCalling).toBe(false);
    expect(CapabilityRegistry.baseline("gemma2:9b").chatCapable).toBe(true);
  });

  it("still gives a genuinely unknown model the conservative floor", () => {
    const caps = CapabilityRegistry.baseline("some-model-nobody-has-heard-of");
    expect(caps.toolCalling).toBe(false);
    expect(caps.jsonSchema).toBe(false);
    expect(caps.jsonObject).toBe(true);
  });
});

describe("strategy ladder", () => {
  it("walks the whole ladder down to the prompted floor", async () => {
    const registry = new CapabilityRegistry({
      "test-model": { jsonSchema: true, toolCalling: true, jsonObject: true, streaming: true },
    });
    const stub = stubFetch([
      { status: 400, json: errorBody("response_format is not supported") },
      { status: 400, json: errorBody("tools are not supported by this model") },
      { json: completion('{"title":"Floor","score":0}') },
    ]);

    const path: StructuringStrategyName[] = [];
    const result = await generateObject({
      client: testClient(stub, registry),
      model: "test-model",
      schema: Report,
      prompt: "summarise",
      onEvent: (event) => {
        if (event.type === "strategy_downgraded") path.push(event.to);
      },
    });

    expect(path).toEqual(["tool_call", "prompted_json"]);
    expect(result.metadata.strategy).toBe("prompted_json");
    // The floor strategy must put the schema in the prompt.
    const finalMessages = (stub.requests[2]?.body as ChatCompletionRequest).messages;
    expect(finalMessages[0]?.role).toBe("system");
    expect(finalMessages[0]?.content).toContain("JSON Schema");
  });

  it("reports a 402 as payment_required, not a generic http_error", async () => {
    // The live API returns this when the account has no payment method. It is
    // not a bad request and retrying never helps, so a caller needs to be able
    // to branch on it without matching message text.
    const stub = stubFetch([
      { status: 402, json: errorBody("A valid payment method is required to use RelaxAI API.") },
    ]);

    await expect(
      generateObject({
        client: testClient(stub, ALL_TIERS),
        model: "test-model",
        schema: Report,
        prompt: "summarise",
      }),
    ).rejects.toMatchObject({ code: "payment_required", status: 402, retryable: false });

    // And it must not be mistaken for a capability rejection: dropping a tier
    // would spend a second request on an account that cannot pay for the first.
    expect(stub.requests).toHaveLength(1);
  });

  it("does not downgrade on an error that is not a capability rejection", async () => {
    const registry = new CapabilityRegistry({
      "test-model": { jsonSchema: true, toolCalling: true, jsonObject: true },
    });
    const stub = stubFetch([{ status: 401, json: errorBody("invalid api key") }]);

    await expect(
      generateObject({
        client: testClient(stub, registry),
        model: "test-model",
        schema: Report,
        prompt: "summarise",
      }),
    ).rejects.toMatchObject({ code: "http_error", status: 401 });
    expect(stub.requests).toHaveLength(1);
  });
});
