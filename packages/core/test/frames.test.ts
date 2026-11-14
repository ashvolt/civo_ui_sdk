import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CapabilityRegistry } from "../src/capability/registry.js";
import type { FetchLike } from "../src/client/http.js";
import type { InferenceClient } from "../src/client/inference-client.js";
import { OpenAICompatibleClient } from "../src/client/openai-compatible-client.js";
import { generateObject, streamObject, toSSEStream, type GenerationTrace } from "../src/generate.js";
import { ollama } from "../src/provider/profile.js";
import { decodeSSE } from "../src/stream/sse.js";
import { UIStreamAccumulator, type UIStreamEvent } from "../src/protocol.js";
import { defineStructuredSchema } from "../src/schema/define.js";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../src/types.js";
import { displayText } from "../src/ui/contract.js";
import {
  completion,
  contentChunks,
  errorBody,
  stubFetch,
  testClient,
  toolChunks,
  type Stub,
} from "./helpers.js";

/**
 * Frame creation (feature 002).
 *
 * Every case here was first observed against a real local model and then
 * reduced to a scripted stream: a forced tool call that returns nothing, a
 * tool call that arrives whole in one chunk, a document written as plain
 * message text, a schema keyword the endpoint silently ignores. Feature 001's
 * tests cover the pipeline against a well-behaved endpoint; these cover the
 * ways an open-weight model behind a local runtime is not one.
 */

const Report = defineStructuredSchema({
  name: "Report",
  schema: z.object({ title: z.string(), score: z.number() }),
});

/** Carries a `pattern`, via the SDK's own control-character guard. */
const Card = defineStructuredSchema({
  name: "Card",
  schema: z.object({ title: displayText(40) }).strict(),
});

const ALL_TIERS = () =>
  new CapabilityRegistry({
    "test-model": { jsonSchema: true, toolCalling: true, jsonObject: true, streaming: true },
  });

const TOOLS_THEN_FLOOR = () =>
  new CapabilityRegistry({
    "test-model": { jsonSchema: false, toolCalling: true, jsonObject: true, streaming: true },
  });

/** What Ollama sends when a forced tool call produces nothing at all. */
const EMPTY_STREAM = [
  chunk({ role: "assistant", content: "" }, null),
  chunk({}, "stop"),
];

function chunk(delta: Record<string, unknown>, finish: string | null): unknown {
  return {
    id: "c",
    object: "chat.completion.chunk",
    created: 0,
    model: "test-model",
    choices: [{ index: 0, finish_reason: finish, delta }],
  };
}

async function collect<T>(events: AsyncIterable<UIStreamEvent<T>>): Promise<UIStreamEvent<T>[]> {
  const out: UIStreamEvent<T>[] = [];
  for await (const event of events) out.push(event);
  return out;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value, { stream: true });
  }
}

function ollamaClient(stub: Stub): OpenAICompatibleClient {
  return new OpenAICompatibleClient({
    provider: "ollama",
    fetch: stub.fetch,
    // A private registry with the profile's own refinement, so tests do not
    // share observations through the process-wide scope.
    capabilities: new CapabilityRegistry(undefined, { endpointDefaults: ollama.capabilities ?? {} }),
    retry: { maxRetries: 0, sleep: async () => undefined },
  });
}

const kinds = (events: UIStreamEvent<unknown>[]) => events.map((event) => event.type);

describe("a generation that cannot start", () => {
  it("reports an embeddings model with its own code, as a single error frame", async () => {
    const stub = stubFetch([{ sse: [] }]);
    const events = await collect(
      streamObject({ client: testClient(stub), model: "nomic-embed-text", schema: Report, prompt: "x" }),
    );

    expect(kinds(events)).toEqual(["error"]);
    // Was `transport_error`: the generator threw, and only the SSE adapter's
    // last-resort handler turned it into a frame — losing the code on the way.
    expect(events[0]).toMatchObject({ type: "error", error: { code: "capability_unsupported" } });
    expect(stub.requests).toHaveLength(0);
  });

  it("reports a missing prompt as config_invalid", async () => {
    const stub = stubFetch([{ sse: [] }]);
    const events = await collect(
      streamObject({ client: testClient(stub, ALL_TIERS()), model: "test-model", schema: Report }),
    );
    expect(kinds(events)).toEqual(["error"]);
    expect(events[0]).toMatchObject({ error: { code: "config_invalid", retryable: false } });
  });

  it("still terminates the SSE body with [DONE]", async () => {
    const stub = stubFetch([{ sse: [] }]);
    const body = await drain(
      toSSEStream(streamObject({ client: testClient(stub), model: "nomic-embed-text", schema: Report, prompt: "x" })),
    );
    expect(body).toContain('"code":"capability_unsupported"');
    expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("carries a request id, so the failure can be found in a log", async () => {
    const stub = stubFetch([{ sse: [] }]);
    const [event] = await collect(
      streamObject({ client: testClient(stub), model: "nomic-embed-text", schema: Report, prompt: "x" }),
    );
    expect(event).toMatchObject({ type: "error" });
    expect((event as { error: { requestId?: string } }).error.requestId).toBeTruthy();
  });
});

describe("a mechanism that returns nothing", () => {
  it("moves down a tier instead of re-asking the one that went unanswered", async () => {
    const stub = stubFetch([{ sse: EMPTY_STREAM }, { sse: contentChunks('{"title":"Q1","score":4}', 6) }]);
    const traces: GenerationTrace[] = [];
    const registry = TOOLS_THEN_FLOOR();

    const events = await collect(
      streamObject({
        client: testClient(stub, registry),
        model: "test-model",
        schema: Report,
        prompt: "x",
        onEvent: (trace) => traces.push(trace),
      }),
    );

    const complete = events.at(-1);
    expect(complete).toMatchObject({
      type: "complete",
      value: { title: "Q1", score: 4 },
      metadata: { strategy: "prompted_json", downgradedFrom: ["tool_call"] },
    });
    expect(stub.requests).toHaveLength(2);
    expect((stub.requests[0]?.body as ChatCompletionRequest).tools).toBeDefined();
    expect((stub.requests[1]?.body as ChatCompletionRequest).tools).toBeUndefined();
    expect(traces).toContainEqual(
      expect.objectContaining({ type: "strategy_downgraded", from: "tool_call", to: "prompted_json" }),
    );
  });

  it("names, in `meta`, the mechanism that actually produced the document", async () => {
    // The reason `meta` is written lazily. Written on the first upstream chunk
    // it would have said `tool_call`, and the document then arrives by another
    // route with no way to take that back.
    const stub = stubFetch([{ sse: EMPTY_STREAM }, { sse: contentChunks('{"title":"Q1","score":4}', 6) }]);
    const events = await collect(
      streamObject({ client: testClient(stub, TOOLS_THEN_FLOOR()), model: "test-model", schema: Report, prompt: "x" }),
    );

    expect(events[0]).toMatchObject({ type: "meta", strategy: "prompted_json" });
    expect(kinds(events).filter((kind) => kind === "meta")).toHaveLength(1);
  });

  it("does not remember it: an empty answer is not a property of the endpoint", async () => {
    const stub = stubFetch([{ sse: EMPTY_STREAM }, { sse: contentChunks('{"title":"Q1","score":4}', 6) }]);
    const registry = TOOLS_THEN_FLOOR();
    await collect(
      streamObject({ client: testClient(stub, registry), model: "test-model", schema: Report, prompt: "x" }),
    );
    expect(registry.get("test-model").toolCalling).toBe(true);
  });

  it("is a typed error when there is no tier left to move to", async () => {
    const stub = stubFetch([
      { sse: EMPTY_STREAM },
      { json: { id: "x", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "" } }] } },
    ]);
    const events = await collect(
      streamObject({
        client: testClient(stub, TOOLS_THEN_FLOOR()),
        model: "test-model",
        schema: Report,
        prompt: "x",
        forceStrategy: "tool_call",
      }),
    );
    expect(kinds(events)).toEqual(["meta", "error"]);
    expect(events[0]).toMatchObject({ strategy: "tool_call" });
    expect(events[1]).toMatchObject({ error: { code: "no_content" } });
  });

  it("is `truncated`, not a downgrade, when the budget ran out before any text", async () => {
    // A reasoning model that spent everything thinking. Asking again through a
    // weaker mechanism with the same budget would think for just as long.
    const stub = stubFetch([{ sse: [chunk({ role: "assistant", content: "" }, null), chunk({}, "length")] }]);
    const events = await collect(
      streamObject({ client: testClient(stub, TOOLS_THEN_FLOOR()), model: "test-model", schema: Report, prompt: "x" }),
    );
    expect(kinds(events)).toEqual(["meta", "error"]);
    expect(events[1]).toMatchObject({ error: { code: "truncated" } });
    expect(stub.requests).toHaveLength(1);
  });

  it("moves down a tier on the batch path too", async () => {
    const empty = { id: "x", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "" } }] };
    const stub = stubFetch([{ json: empty }, { json: completion('{"title":"Q1","score":4}') }]);
    const result = await generateObject({
      client: testClient(stub, TOOLS_THEN_FLOOR()),
      model: "test-model",
      schema: Report,
      prompt: "x",
    });
    expect(result.object).toEqual({ title: "Q1", score: 4 });
    expect(result.metadata).toMatchObject({ strategy: "prompted_json", downgradedFrom: ["tool_call"] });
  });
});

describe("a forced tool call answered as message text", () => {
  it("reads the document from the text, without a second generation", async () => {
    const stub = stubFetch([{ sse: contentChunks('{"title":"From content","score":2}', 9) }]);
    const events = await collect(
      streamObject({
        client: testClient(stub, TOOLS_THEN_FLOOR()),
        model: "test-model",
        schema: Report,
        prompt: "x",
      }),
    );

    expect(events.at(-1)).toMatchObject({
      type: "complete",
      value: { title: "From content", score: 2 },
      metadata: { strategy: "tool_call", downgradedFrom: [], repairAttempts: 0 },
    });
    expect(stub.requests).toHaveLength(1);
  });

  it("prefers the tool channel when the model used both", async () => {
    const both = [
      chunk({ content: "Sure, here is the report: " }, null),
      ...toolChunks("Report", '{"title":"From tool","score":8}', 10),
    ];
    const stub = stubFetch([{ sse: both }]);
    const events = await collect(
      streamObject({ client: testClient(stub, TOOLS_THEN_FLOOR()), model: "test-model", schema: Report, prompt: "x" }),
    );
    expect(events.at(-1)).toMatchObject({ type: "complete", value: { title: "From tool", score: 8 } });
  });
});

describe("a tool call delivered whole in one chunk", () => {
  it("is one document frame — correct, and the reason the constrained tier is preferred", async () => {
    // What Ollama does: the arguments are buffered and sent in a single chunk.
    const whole = [chunk({ role: "assistant", content: "" }, null), ...toolChunks("Report", '{"title":"Q1","score":4}', 1_000)];
    const stub = stubFetch([{ sse: whole }]);
    const events = await collect(
      streamObject({ client: testClient(stub, TOOLS_THEN_FLOOR()), model: "test-model", schema: Report, prompt: "x" }),
    );
    expect(kinds(events)).toEqual(["meta", "snapshot", "complete"]);
  });
});

describe("the opening frame", () => {
  it("is first, and exactly one, when the model thinks before it writes", async () => {
    const thinking = [
      ...contentChunks("<think>Let me plan the layout carefully.</think>", 9),
      ...contentChunks('{"title":"Q1","score":4}', 7),
    ];
    const registry = new CapabilityRegistry({
      "test-model": { jsonSchema: true, toolCalling: true, jsonObject: true, streaming: true, reasoningTrace: true },
    });
    const stub = stubFetch([{ sse: thinking }]);
    const events = await collect(
      streamObject({ client: testClient(stub, registry), model: "test-model", schema: Report, prompt: "x" }),
    );

    expect(events[0]?.type).toBe("meta");
    expect(kinds(events).filter((kind) => kind === "meta")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("complete");
  });

  it("names the provider, and so does the completion metadata", async () => {
    const stub = stubFetch([{ sse: contentChunks('{"title":"Q1","score":4}', 7) }]);
    const events = await collect(
      streamObject({ client: ollamaClient(stub), model: "qwen2.5:7b", schema: Report, prompt: "x" }),
    );
    expect(events[0]).toMatchObject({ type: "meta", provider: "ollama", strategy: "native_json_schema" });
    expect(events.at(-1)).toMatchObject({ type: "complete", metadata: { provider: "ollama" } });
  });

  it("says relaxai for the default client", async () => {
    const stub = stubFetch([{ sse: contentChunks('{"title":"Q1","score":4}', 7) }]);
    const events = await collect(
      streamObject({ client: testClient(stub, ALL_TIERS()), model: "test-model", schema: Report, prompt: "x" }),
    );
    expect(events[0]).toMatchObject({ type: "meta", provider: "relaxai" });
  });

  it("names the strategy the batch fallback ended on, not the one it started with", async () => {
    const registry = new CapabilityRegistry({
      "test-model": { jsonSchema: true, toolCalling: true, jsonObject: true, streaming: false },
    });
    const stub = stubFetch([
      { status: 400, json: errorBody("response_format json_schema is not supported") },
      { json: { id: "x", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c", type: "function", function: { name: "Report", arguments: '{"title":"Q1","score":4}' } }] } }] } },
    ]);
    const events = await collect(
      streamObject({ client: testClient(stub, registry), model: "test-model", schema: Report, prompt: "x" }),
    );
    expect(events[0]).toMatchObject({ type: "meta", strategy: "tool_call" });
    expect(events.at(-1)).toMatchObject({ metadata: { strategy: "tool_call", downgradedFrom: ["native_json_schema"] } });
  });
});

describe("the schema put on the wire", () => {
  const sentSchema = (stub: Stub, index = 0) =>
    JSON.stringify((stub.requests[index]?.body as ChatCompletionRequest).response_format);

  it("omits `pattern` for an endpoint that cannot enforce a schema carrying it", async () => {
    const stub = stubFetch([{ sse: contentChunks('{"title":"Hello"}', 5) }]);
    const traces: GenerationTrace[] = [];
    const events = await collect(
      streamObject({
        client: ollamaClient(stub),
        model: "qwen2.5:7b",
        schema: Card,
        prompt: "x",
        onEvent: (trace) => traces.push(trace),
      }),
    );

    expect(JSON.stringify(Card.jsonSchema)).toContain('"pattern"');
    expect(sentSchema(stub)).not.toContain('"pattern"');
    expect(sentSchema(stub)).toContain('"maxLength":40');
    expect(events.at(-1)?.type).toBe("complete");
    // Never silent: telling the model less than the validator enforces is
    // reported, with the provider and the keywords.
    expect(traces).toContainEqual({ type: "schema_adapted", provider: "ollama", dropped: ["pattern"] });
  });

  it("is the application's own schema for relaxAI", async () => {
    const stub = stubFetch([{ sse: contentChunks('{"title":"Hello"}', 5) }]);
    const traces: GenerationTrace[] = [];
    await collect(
      streamObject({
        client: testClient(stub, ALL_TIERS()),
        model: "test-model",
        schema: Card,
        prompt: "x",
        onEvent: (trace) => traces.push(trace),
      }),
    );
    expect(sentSchema(stub)).toContain('"pattern"');
    expect(traces.some((trace) => trace.type === "schema_adapted")).toBe(false);
  });

  it("still refuses a value the omitted keyword would have prevented", async () => {
    // FR-112. The server was not told about the control-character rule, the
    // model broke it, and the application's schema refuses it all the same.
    const stub = stubFetch([
      { sse: contentChunks('{"title":"bell\\u0007"}', 50) },
      { json: completion('{"title":"bell\\u0007"}') },
    ]);
    const events = await collect(
      streamObject({ client: ollamaClient(stub), model: "qwen2.5:7b", schema: Card, prompt: "x", maxRepairAttempts: 0 }),
    );
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "schema_violation" } });
    expect(kinds(events)).not.toContain("complete");
  });

  it("adapts tool parameters too, and gives the prompted tier the full description", async () => {
    const toolsFirst = new CapabilityRegistry({
      "m": { jsonSchema: false, toolCalling: true, jsonObject: true, streaming: true },
    });
    const stub = stubFetch([{ sse: EMPTY_STREAM }, { sse: contentChunks('{"title":"Hello"}', 5) }]);
    const client = new OpenAICompatibleClient({
      provider: "ollama",
      fetch: stub.fetch,
      capabilities: toolsFirst,
      retry: { maxRetries: 0 },
    });
    await collect(streamObject({ client, model: "m", schema: Card, prompt: "x" }));

    const tool = stub.requests[0]?.body as ChatCompletionRequest;
    const prompted = stub.requests[1]?.body as ChatCompletionRequest;
    expect(JSON.stringify(tool.tools)).not.toContain('"pattern"');
    // The prompted tier is read by the model rather than compiled by the
    // server, so nothing is gained by telling it less.
    expect(prompted.messages[0]?.content).toContain('"pattern"');
  });
});

describe("the ladder on a local provider", () => {
  it("tries the constrained tier first, because that is the one that streams", async () => {
    const stub = stubFetch([{ sse: contentChunks('{"title":"Local","score":1}', 4) }]);
    const events = await collect(
      streamObject({ client: ollamaClient(stub), model: "qwen2.5:7b", schema: Report, prompt: "x" }),
    );

    expect((stub.requests[0]?.body as ChatCompletionRequest).response_format?.type).toBe("json_schema");
    // More than one document frame: the point of FR-113.
    expect(events.filter((event) => event.type === "patch" || event.type === "snapshot").length).toBeGreaterThan(1);
  });

  it("walks down when an older runtime refuses it, and says so through onEvent", async () => {
    const stub = stubFetch([
      { status: 400, json: errorBody("response_format json_schema is not supported by this model") },
      { sse: toolChunks("Report", '{"title":"Local","score":1}', 6) },
    ]);
    const traces: GenerationTrace[] = [];
    const client = ollamaClient(stub);
    const events = await collect(
      streamObject({ client, model: "qwen2.5:7b", schema: Report, prompt: "x", onEvent: (t) => traces.push(t) }),
    );

    expect(events.at(-1)).toMatchObject({
      type: "complete",
      metadata: { strategy: "tool_call", downgradedFrom: ["native_json_schema"] },
    });
    // Feature 001's streaming path never emitted these; only the batch path did.
    expect(traces[0]).toMatchObject({ type: "strategy_selected", strategy: "native_json_schema" });
    expect(traces).toContainEqual(
      expect.objectContaining({ type: "strategy_downgraded", from: "native_json_schema", to: "tool_call" }),
    );
    expect(traces.at(-1)).toMatchObject({ type: "validated", strategy: "tool_call" });
    // And a rejection, unlike an empty answer, *is* remembered.
    expect(client.capabilitiesFor("qwen2.5:7b").jsonSchema).toBe(false);
  });
});

describe("an inference client the application wrote itself", () => {
  /**
   * No SDK class, no HTTP, no key: an object with the four members the engine
   * uses. This is what "loosely coupled" has to mean to be worth anything.
   */
  function scripted(text: string): InferenceClient & { calls: ChatCompletionRequest[] } {
    const calls: ChatCompletionRequest[] = [];
    return {
      calls,
      provider: { id: "in-process", label: "In-process model", sovereign: false, local: true },
      capabilities: new CapabilityRegistry({
        "tiny": { jsonSchema: false, toolCalling: false, jsonObject: false, streaming: true },
      }),
      async listModels() {
        return [{ id: "tiny" }];
      },
      async chatCompletion(request) {
        calls.push(request);
        return completion(text) as ChatCompletionResponse;
      },
      async *streamChatCompletion(request) {
        calls.push(request);
        for (const piece of contentChunks(text, 5)) yield piece as ChatCompletionResponse;
      },
    };
  }

  it("drives streamObject", async () => {
    const client = scripted('{"title":"No HTTP involved","score":3}');
    const accumulator = new UIStreamAccumulator<{ title: string; score: number }>();
    for await (const event of streamObject({ client, model: "tiny", schema: Report, prompt: "x" })) {
      accumulator.apply(event);
    }

    expect(accumulator.meta()).toMatchObject({ provider: "in-process", strategy: "prompted_json" });
    expect(accumulator.result()?.value).toEqual({ title: "No HTTP involved", score: 3 });
    expect(client.calls).toHaveLength(1);
  });

  it("drives generateObject", async () => {
    const client = scripted('{"title":"Batch","score":1}');
    const result = await generateObject({ client, model: "tiny", schema: Report, prompt: "x" });
    expect(result.object).toEqual({ title: "Batch", score: 1 });
    expect(result.metadata.provider).toBe("in-process");
  });

  it("tolerates one that forgot to say who it is", async () => {
    const client = scripted('{"title":"Anonymous","score":1}');
    const anonymous = { ...client, provider: undefined } as unknown as InferenceClient;
    const events = await collect(streamObject({ client: anonymous, model: "tiny", schema: Report, prompt: "x" }));
    expect(events[0]).toMatchObject({ type: "meta" });
    expect(events[0]).not.toHaveProperty("provider");
    expect(events.at(-1)?.type).toBe("complete");
  });
});

describe("stopping early actually stops the upstream", () => {
  /**
   * An SSE body that never ends on its own, and records being cancelled.
   *
   * The scripted streams elsewhere in this file close as soon as they are
   * built, which is exactly why they could not see this: a body that has
   * already ended looks the same whether or not anyone cancelled it.
   */
  function endlessBody(frames: unknown[]): { body: ReadableStream<Uint8Array>; cancelled: () => boolean } {
    const encoder = new TextEncoder();
    let index = 0;
    let wasCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const frame = frames[index++];
        // Out of scripted frames: stay open, as a model mid-generation does.
        if (frame !== undefined) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}

`));
      },
      cancel() {
        wasCancelled = true;
      },
    });
    return { body, cancelled: () => wasCancelled };
  }

  it("cancels the response body when the consumer stops reading", async () => {
    const { body, cancelled } = endlessBody([{ n: 1 }, { n: 2 }, { n: 3 }]);
    for await (const event of decodeSSE(body)) {
      if (event.data.includes('"n":2')) break;
    }
    // Releasing the reader's lock is not enough. The connection stays open and
    // the server keeps generating — and billing — for a reader that has gone.
    expect(cancelled()).toBe(true);
  });

  it("cancels it when a frame fails the schema mid-stream", async () => {
    // Acceptance scenario 5 of feature 001 promises the stream ends "rather
    // than after the remaining tokens are generated and paid for". Ending the
    // *output* stream was implemented; ending the *upstream* one was not.
    const { body, cancelled } = endlessBody(contentChunks('{"title":"ok","score":"not a number","more":', 12));
    const fetchImpl: FetchLike = async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    const client = new OpenAICompatibleClient({
      apiKey: "k",
      fetch: fetchImpl,
      capabilities: ALL_TIERS(),
      retry: { maxRetries: 0 },
    });

    const events = await collect(streamObject({ client, model: "test-model", schema: Report, prompt: "x" }));

    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "schema_violation" } });
    expect(cancelled()).toBe(true);
  });

  it("cancels it when the consumer of the UI stream goes away", async () => {
    const { body, cancelled } = endlessBody(contentChunks('{"title":"A long title that keeps going', 6));
    const fetchImpl: FetchLike = async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    const client = new OpenAICompatibleClient({
      apiKey: "k",
      fetch: fetchImpl,
      capabilities: ALL_TIERS(),
      retry: { maxRetries: 0 },
    });

    const reader = toSSEStream(
      streamObject({ client, model: "test-model", schema: Report, prompt: "x" }),
    ).getReader();
    await reader.read(); // meta
    await reader.read(); // first document frame
    await reader.cancel();

    expect(cancelled()).toBe(true);
  });
});

describe("a model that goes quiet mid-answer (spec 002, T-160)", () => {
  /** An SSE body that sends its frames, then stays open and silent; records being cancelled. */
  function stallingBody(frames: unknown[]): { body: ReadableStream<Uint8Array>; cancelled: () => boolean } {
    const encoder = new TextEncoder();
    let wasCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(f)}\n\n`));
      },
      cancel() {
        wasCancelled = true;
      },
    });
    return { body, cancelled: () => wasCancelled };
  }

  const clientFor = (body: ReadableStream<Uint8Array>, limits: { timeoutMs?: number; idleTimeoutMs?: number }) =>
    new OpenAICompatibleClient({
      apiKey: "k",
      fetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
      capabilities: ALL_TIERS(),
      retry: { maxRetries: 0 },
      ...limits,
    });

  it("ends the UI stream with a timeout error frame and cancels the upstream", async () => {
    const { body, cancelled } = stallingBody(contentChunks('{"title":"A title that stops', 8));
    const client = clientFor(body, { idleTimeoutMs: 60 });

    const events = await collect(streamObject({ client, model: "test-model", schema: Report, prompt: "x" }));

    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "timeout", retryable: true } });
    expect(cancelled()).toBe(true);
  });

  it("defaults the idle limit to the request timeout, so a stall no longer holds the request for good", async () => {
    const { body, cancelled } = stallingBody(contentChunks('{"title":"Stops', 8));
    const client = clientFor(body, { timeoutMs: 60 });

    const events = await collect(streamObject({ client, model: "test-model", schema: Report, prompt: "x" }));

    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "timeout" } });
    expect(cancelled()).toBe(true);
  });

  it("a per-request idle limit overrides the client's", async () => {
    const { body } = stallingBody(contentChunks('{"title":"Stops', 8));
    const client = clientFor(body, { idleTimeoutMs: 60_000 });
    const started = Date.now();

    const events = await collect(streamObject({ client, model: "test-model", schema: Report, prompt: "x", idleTimeoutMs: 60 }));

    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "timeout" } });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("protocol 2: a growing text sent as append (spec 002, T-159)", () => {
  const json = '{"title":"Sovereign inference keeps prompts in the UK","score":7}';
  const run = (protocol?: 1 | 2) =>
    collect(
      streamObject({
        client: testClient(stubFetch([{ sse: contentChunks(json, 4) }]), ALL_TIERS()),
        model: "test-model",
        schema: Report,
        prompt: "x",
        ...(protocol ? { protocol } : {}),
      }),
    );
  const ops = (events: UIStreamEvent<unknown>[]) => events.flatMap((e) => (e.type === "patch" ? e.ops : []));

  it("writes append ops and says protocol 2 when asked", async () => {
    const events = await run(2);
    expect(events[0]).toMatchObject({ type: "meta", protocol: 2 });
    expect(ops(events).some((op) => op.op === "append" && op.path === "/title")).toBe(true);
    const acc = new UIStreamAccumulator();
    for (const e of events) acc.apply(e);
    expect(acc.result()?.value).toEqual({ title: "Sovereign inference keeps prompts in the UK", score: 7 });
  });

  it("by default writes protocol 1, with no append, so an older client is never sent one", async () => {
    const events = await run();
    expect(events[0]).toMatchObject({ type: "meta", protocol: 1 });
    expect(ops(events).some((op) => op.op === "append")).toBe(false);
  });

  it("both protocols draw the same document at every frame", async () => {
    const fold = (events: UIStreamEvent<unknown>[]) => {
      const acc = new UIStreamAccumulator();
      return events.filter((e) => e.type === "patch" || e.type === "snapshot").map((e) => (acc.apply(e), JSON.stringify(acc.current())));
    };
    expect(fold(await run(2))).toEqual(fold(await run(1)));
  });
});
