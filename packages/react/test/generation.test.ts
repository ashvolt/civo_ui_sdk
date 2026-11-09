import type { RelaxUIError } from "relax-ui-core";
import type { SocketLike, Source } from "relax-ui-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  INITIAL_STATE,
  planGeneration,
  runGeneration,
  type GenerationOptions,
  type GenerativeObjectState,
} from "../src/generation.js";

// --- fixtures ------------------------------------------------------------------

const schema = z.object({ title: z.string(), total: z.number() }).strict();
type Doc = z.infer<typeof schema>;

const META = { type: "meta", protocol: 1, requestId: "r1", model: "m", provider: "ollama", schema: "Doc", strategy: "tool_call" };
const PATCH_1 = { type: "patch", seq: 1, ops: [{ op: "add", path: "", value: { title: "Q3" } }] };
const PATCH_2 = { type: "patch", seq: 2, ops: [{ op: "add", path: "/total", value: 4 }] };
// Wrong type for a present field: fatal however early in the stream.
const BAD_PATCH_2 = { type: "patch", seq: 2, ops: [{ op: "add", path: "/total", value: "secret-looking text" }] };
const METADATA = { requestId: "r1", model: "m", strategy: "tool_call", downgradedFrom: [], repairAttempts: 0, durationMs: 5 };
const COMPLETE = { type: "complete", value: { title: "Q3", total: 4 }, metadata: METADATA };

const data = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

function sse(events: unknown[], onCancel?: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const frames = events.map(data);
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = frames.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(encoder.encode(next));
    },
    cancel() {
      onCancel?.();
    },
  });
}

class FakeSocket implements SocketLike {
  readyState = 1;
  closeCalls = 0;
  private listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();
  addEventListener(type: string, l: (event: { data?: unknown }) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(l);
  }
  removeEventListener(type: string, l: (event: { data?: unknown }) => void) {
    this.listeners.get(type)?.delete(l);
  }
  close() {
    this.closeCalls++;
  }
  emit(type: string, event: { data?: unknown }) {
    for (const l of [...(this.listeners.get(type) ?? [])]) l(event);
  }
  sendEvent(event: unknown) {
    this.emit("message", { data: JSON.stringify(event) });
  }
}

/** Runs one generation and returns every state it passed through. */
async function run<T = Doc>(options: GenerationOptions<T>, body: unknown = { q: 1 }, signal = new AbortController().signal) {
  const states: GenerativeObjectState<T>[] = [];
  let state: GenerativeObjectState<T> = { ...(INITIAL_STATE as GenerativeObjectState<T>), isStreaming: true };
  const onComplete = vi.fn();
  const onError = vi.fn();
  await runGeneration<T>({ onComplete, onError, ...options }, body, signal, (patch) => {
    state = { ...state, ...patch };
    states.push(state);
  });
  return { state, states, onComplete, onError };
}

function stubFetch(body: () => ReadableStream<Uint8Array>, status = 200) {
  const fetch = vi.fn(async () => new Response(body(), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const PAGE = "https://bank.example";

// --- T-215 at the hook: refusals ---------------------------------------------

describe("planGeneration refusals (T-215)", () => {
  const socket = new FakeSocket();
  it.each<[string, Source<Doc>]>([
    ["a document", { document: { title: "x", total: 1 } }],
    ["a stream", { stream: sse([]) }],
    ["a socket", { socket }],
    ["a cross-origin URL", { url: "https://elsewhere.example/api/ui" }],
  ])('refuses validate: "server" for %s', (_name, source) => {
    expect(() => planGeneration<Doc>({ source, validate: "server", schema }, PAGE)).toThrowError(
      expect.objectContaining({ code: "config_invalid" }),
    );
  });

  it('accepts validate: "server" for a same-origin URL, with or without a schema', () => {
    expect(planGeneration<Doc>({ source: { url: "/api/ui" }, validate: "server" }, PAGE).tier).toBe("server");
    expect(planGeneration<Doc>({ source: { url: `${PAGE}/api/ui` }, validate: "server", schema }, PAGE).tier).toBe(
      "server",
    );
  });

  it("requires a schema for full validation", () => {
    for (const source of [{ document: {} }, { stream: sse([]) }, { socket }, { url: "/api/ui" }] as Source<Doc>[]) {
      expect(() => planGeneration<Doc>({ source }, PAGE)).toThrowError(
        expect.objectContaining({ code: "config_invalid", message: expect.stringContaining("schema") }),
      );
    }
  });

  it("requires some source", () => {
    expect(() => planGeneration<Doc>({}, PAGE)).toThrowError(expect.objectContaining({ code: "config_invalid" }));
  });

  it("a refused configuration makes no request and reports config_invalid", async () => {
    const fetch = stubFetch(() => sse([COMPLETE]));
    const { state, onError } = await run({ source: { url: "https://elsewhere.example/ui" }, validate: "server", schema });
    expect(fetch).not.toHaveBeenCalled();
    expect(state.error?.code).toBe("config_invalid");
    expect(state.isStreaming).toBe(false);
    expect(state.object).toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });
});

// --- NFR-206: the `api` option keeps its meaning --------------------------------

describe("`api` (features 001 and 002, unchanged)", () => {
  it("a same-origin route without a schema renders as before", async () => {
    const fetch = stubFetch(() => sse([META, PATCH_1, PATCH_2, COMPLETE]));
    const { state, onComplete } = await run({ api: "/api/ui" }, { topic: "q3" });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ui");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ topic: "q3" }));
    expect(state.value).toEqual({ title: "Q3", total: 4 });
    expect(state.strategy).toBe("tool_call");
    expect(state.provider).toBe("ollama");
    expect(state.metadata).toEqual(METADATA);
    expect(onComplete).toHaveBeenCalledWith({ title: "Q3", total: 4 }, METADATA);
  });

  it("a same-origin route trusts the server's partial frames, as before", async () => {
    // The server tier does not check partial frames; only the final object
    // against `schema`, if given — exactly the original behaviour.
    stubFetch(() => sse([PATCH_1, BAD_PATCH_2]));
    const { state } = await run({ api: "/api/ui", schema });
    expect(state.error).toBeUndefined();
    expect(state.object).toEqual({ title: "Q3", total: "secret-looking text" });
  });

  it("a same-origin route with a schema still re-checks the completed object", async () => {
    stubFetch(() => sse([{ ...COMPLETE, value: { title: "Q3" } }]));
    const { state } = await run({ api: "/api/ui", schema });
    expect(state.error?.code).toBe("schema_violation");
    expect(state.error?.message).toMatch(/client-side re-validation/);
    expect(state.value).toBeUndefined();
  });

  it("an HTTP failure is reported as before", async () => {
    stubFetch(() => sse([]), 503);
    const { state } = await run({ api: "/api/ui" });
    expect(state.error?.code).toBe("http_error");
    expect(state.error?.retryable).toBe(true);
  });

  it("a cross-origin route is foreign: validated in full, so it needs a schema", async () => {
    const fetch = stubFetch(() => sse([COMPLETE]));
    const refused = await run({ api: "https://elsewhere.example/api/ui" });
    expect(refused.state.error?.code).toBe("config_invalid");
    expect(fetch).not.toHaveBeenCalled();

    const accepted = await run({ api: "https://elsewhere.example/api/ui", schema });
    expect(accepted.state.value).toEqual({ title: "Q3", total: 4 });
  });
});

// --- T-216: full validation of foreign sources ---------------------------------

describe("full validation in the browser (T-216)", () => {
  it("stops at the first invalid frame and never puts it in state", async () => {
    let cancelled = false;
    const stream = sse([META, PATCH_1, BAD_PATCH_2, COMPLETE], () => (cancelled = true));
    const { state, states, onError } = await run({ source: { stream }, schema });

    expect(state.error?.code).toBe("schema_violation");
    expect(onError).toHaveBeenCalledOnce();
    // The last object any render could have seen is the valid prefix.
    for (const s of states) expect(s.object).not.toEqual(expect.objectContaining({ total: expect.any(String) }));
    expect(state.object).toEqual({ title: "Q3" });
    expect(state.value).toBeUndefined();
    // Reading stopped: the body was cancelled rather than drained.
    expect(cancelled).toBe(true);
  });

  it("reports which field broke, never what it contained", async () => {
    const { state } = await run({ source: { stream: sse([PATCH_1, BAD_PATCH_2]) }, schema });
    expect(state.error?.details).toEqual([{ code: "invalid_type", path: "total" }]);
    expect(JSON.stringify(state.error)).not.toContain("secret-looking");
    expect(JSON.stringify(state.error?.details)).not.toContain("secret-looking");
  });

  it("lets incomplete-but-valid frames through while streaming", async () => {
    const { state, states } = await run({ source: { stream: sse([META, PATCH_1, PATCH_2, COMPLETE]) }, schema });
    expect(state.error).toBeUndefined();
    expect(states.some((s) => JSON.stringify(s.object) === JSON.stringify({ title: "Q3" }))).toBe(true);
    expect(state.value).toEqual({ title: "Q3", total: 4 });
  });

  it("refuses a complete frame that fails the full schema", async () => {
    const { state, onComplete } = await run({
      source: { stream: sse([{ ...COMPLETE, value: { title: "Q3", total: 4, extra: true } }]) },
      schema,
    });
    expect(state.error?.code).toBe("schema_violation");
    expect(state.value).toBeUndefined();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("validates a same-origin URL in full when the source does not opt out", async () => {
    stubFetch(() => sse([PATCH_1, BAD_PATCH_2]));
    const { state } = await run({ source: { url: "/api/ui" }, schema });
    expect(state.error?.code).toBe("schema_violation");
  });

  it('skips partial checks for a same-origin URL with validate: "server"', async () => {
    stubFetch(() => sse([PATCH_1, PATCH_2, COMPLETE]));
    const { state } = await run({ source: { url: "/api/ui" }, validate: "server" });
    expect(state.value).toEqual({ title: "Q3", total: 4 });
  });
});

describe("document source (T-214)", () => {
  it("renders a valid document with no generation metadata", async () => {
    const { state, onComplete } = await run({ source: { document: { title: "Static", total: 1 } }, schema });
    expect(state.error).toBeUndefined();
    expect(state.value).toEqual({ title: "Static", total: 1 });
    expect(state.object).toEqual({ title: "Static", total: 1 });
    expect(state.isStreaming).toBe(false);
    expect(state.metadata).toBeUndefined();
    // Nothing was generated; the caller already has the value.
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("refuses an invalid document before any of it reaches state", async () => {
    // Missing `total`: a stream could still send it, a document cannot.
    const { state, states } = await run({ source: { document: { title: "Static" } as Doc }, schema });
    expect(state.error?.code).toBe("schema_violation");
    expect(states.every((s) => s.object === undefined)).toBe(true);
  });
});

describe("socket source (T-214)", () => {
  it("renders from a socket and leaves it open", async () => {
    const socket = new FakeSocket();
    const done = run({ source: { socket }, schema });
    await Promise.resolve();
    for (const e of [META, PATCH_1, PATCH_2, COMPLETE]) socket.sendEvent(e);
    const { state } = await done;
    expect(state.value).toEqual({ title: "Q3", total: 4 });
    expect(socket.closeCalls).toBe(0);
  });

  it("reports an incomplete document when the socket closes mid-document", async () => {
    const socket = new FakeSocket();
    const done = run({ source: { socket }, schema });
    await Promise.resolve();
    socket.sendEvent(PATCH_1);
    socket.readyState = 3;
    socket.emit("close", {});
    const { state } = await done;
    expect(state.error?.code).toBe("truncated");
    expect(state.object).toEqual({ title: "Q3" });
  });

  it("a stop is quiet: no error, socket open, listeners gone", async () => {
    const socket = new FakeSocket();
    const controller = new AbortController();
    const done = run({ source: { socket }, schema }, undefined, controller.signal);
    await Promise.resolve();
    socket.sendEvent(PATCH_1);
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    const { state, onError } = await done;
    expect(state.error).toBeUndefined();
    expect(state.isStreaming).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(socket.closeCalls).toBe(0);
  });
});

describe("error frames", () => {
  it("carries the server's code and redacted details through", async () => {
    const details = [{ code: "too_big", path: "items" }];
    const { state } = await run({
      source: { stream: sse([{ type: "error", error: { code: "unrepairable", message: "no", retryable: false, details } }]) },
      schema,
    });
    const error = state.error as RelaxUIError;
    expect(error.code).toBe("unrepairable");
    expect(error.details).toEqual(details);
  });
});
