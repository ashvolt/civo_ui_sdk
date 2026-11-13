import {
  decodeSSE,
  DEFAULT_MAX_EVENT_LENGTH,
  readSource,
  RelaxUIError,
  sourceKind,
  UIStreamAccumulator,
  type Source,
  type SocketLike,
  type UIStreamEvent,
} from "relax-ui-protocol";
import { describe, expect, it } from "vitest";

// --- fixtures ------------------------------------------------------------------

const META = { type: "meta", protocol: 1, requestId: "r1", model: "m", schema: "Dashboard", strategy: "tool_call" };
const PATCH_1 = { type: "patch", seq: 1, ops: [{ op: "add", path: "", value: { title: "Q3" } }] };
const PATCH_2 = { type: "patch", seq: 2, ops: [{ op: "add", path: "/total", value: 4 }] };
const COMPLETE = {
  type: "complete",
  value: { title: "Q3", total: 4 },
  metadata: { requestId: "r1", model: "m", strategy: "tool_call", downgradedFrom: [], repairAttempts: 0, durationMs: 5 },
};
const ERROR = { type: "error", error: { code: "schema_violation", message: "bad", retryable: false } };

/**
 * A WebSocket stand-in. Only the surface the reader may touch: listeners and
 * `readyState`. `close` is a spy — the reader must never call it (S2).
 */
class FakeSocket implements SocketLike {
  readyState = 1;
  closeCalls = 0;
  private listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  close(): void {
    this.closeCalls++;
  }
  listenerCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
  send(data: unknown): void {
    for (const l of [...(this.listeners.get("message") ?? [])]) l({ data });
  }
  sendEvent(event: unknown): void {
    this.send(JSON.stringify(event));
  }
  serverClose(): void {
    this.readyState = 3;
    for (const l of [...(this.listeners.get("close") ?? [])]) l({});
  }
  fail(): void {
    for (const l of [...(this.listeners.get("error") ?? [])]) l({});
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function sse(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}
const data = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

async function collect(source: Source, signal?: AbortSignal) {
  const events: UIStreamEvent[] = [];
  let error: unknown;
  try {
    for await (const event of readSource(source, { signal })) events.push(event);
  } catch (cause) {
    error = cause;
  }
  return { events, error };
}

/** Starts reading a socket in the background and exposes what arrives. */
function listen(socket: FakeSocket, signal?: AbortSignal) {
  const events: UIStreamEvent[] = [];
  const state: { error?: unknown; ended: boolean } = { ended: false };
  const done = (async () => {
    try {
      for await (const event of readSource({ socket }, { signal })) events.push(event);
    } catch (cause) {
      state.error = cause;
    } finally {
      state.ended = true;
    }
  })();
  return { events, state, done };
}

// --- socket (T-212) ------------------------------------------------------------

describe("socket source (T-212)", () => {
  it("yields one event per message, in order", async () => {
    const socket = new FakeSocket();
    const run = listen(socket);
    socket.sendEvent(META);
    socket.sendEvent(PATCH_1);
    await tick();
    socket.sendEvent(PATCH_2);
    socket.sendEvent(COMPLETE);
    await run.done;
    expect(run.events.map((e) => e.type)).toEqual(["meta", "patch", "patch", "complete"]);
    expect(run.state.error).toBeUndefined();
  });

  it("is folded by the same accumulator as SSE (S3)", async () => {
    const socket = new FakeSocket();
    const run = listen(socket);
    for (const e of [META, PATCH_1, PATCH_2, COMPLETE]) socket.sendEvent(e);
    await run.done;
    const fromSocket = new UIStreamAccumulator();
    run.events.forEach((e) => fromSocket.apply(e));

    const { events } = await collect({ stream: sse([META, PATCH_1, PATCH_2, COMPLETE].map(data)) });
    const fromStream = new UIStreamAccumulator();
    events.forEach((e) => fromStream.apply(e));

    expect(fromSocket.current()).toEqual(fromStream.current());
    expect(fromSocket.current()).toEqual({ title: "Q3", total: 4 });
  });

  it.each([
    ["complete", COMPLETE],
    ["error", ERROR],
  ])("ends the document at %s and ignores later messages", async (_name, terminal) => {
    const socket = new FakeSocket();
    const run = listen(socket);
    socket.sendEvent(PATCH_1);
    socket.sendEvent(terminal);
    socket.sendEvent(PATCH_2);
    await run.done;
    expect(run.events.map((e) => e.type)).toEqual(["patch", (terminal as { type: string }).type]);
    expect(run.state.error).toBeUndefined();
  });

  it("ends the document at [DONE]", async () => {
    const socket = new FakeSocket();
    const run = listen(socket);
    socket.sendEvent(PATCH_1);
    socket.send("[DONE]");
    socket.sendEvent(PATCH_2);
    await run.done;
    expect(run.events.map((e) => e.type)).toEqual(["patch"]);
    expect(run.state.error).toBeUndefined();
  });

  it("never closes the socket, and stops listening when the document ends (S2)", async () => {
    const socket = new FakeSocket();
    const run = listen(socket);
    socket.sendEvent(COMPLETE);
    await run.done;
    expect(socket.closeCalls).toBe(0);
    expect(socket.listenerCount()).toBe(0);
  });

  it("never closes the socket when the reader is stopped, and stops listening", async () => {
    const socket = new FakeSocket();
    const controller = new AbortController();
    const run = listen(socket, controller.signal);
    socket.sendEvent(PATCH_1);
    await tick();
    controller.abort();
    await run.done;
    expect((run.state.error as RelaxUIError).code).toBe("aborted");
    expect(socket.closeCalls).toBe(0);
    expect(socket.listenerCount()).toBe(0);
  });

  it("reports an incomplete document when the socket closes mid-document", async () => {
    const socket = new FakeSocket();
    const run = listen(socket);
    socket.sendEvent(PATCH_1);
    socket.serverClose();
    await run.done;
    // The patch that arrived before the close is still delivered.
    expect(run.events.map((e) => e.type)).toEqual(["patch"]);
    expect(run.state.error).toBeInstanceOf(RelaxUIError);
    expect((run.state.error as RelaxUIError).code).toBe("truncated");
  });

  it("reports an incomplete document for a socket that is already closed", async () => {
    const socket = new FakeSocket();
    socket.readyState = 3;
    const { events, error } = await collect({ socket });
    expect(events).toEqual([]);
    expect((error as RelaxUIError).code).toBe("truncated");
  });

  it("reports a transport error when the socket errors", async () => {
    const socket = new FakeSocket();
    const run = listen(socket);
    socket.fail();
    await run.done;
    expect((run.state.error as RelaxUIError).code).toBe("transport_error");
    expect(socket.listenerCount()).toBe(0);
  });

  it("drops messages that are not SDK events instead of dying", async () => {
    const socket = new FakeSocket();
    const run = listen(socket);
    socket.send("not json");
    socket.send(JSON.stringify({ type: "hello" }));
    socket.send("");
    socket.sendEvent(PATCH_1);
    socket.sendEvent(COMPLETE);
    await run.done;
    expect(run.events.map((e) => e.type)).toEqual(["patch", "complete"]);
  });

  it("accepts binary frames: ArrayBuffer, typed array and Blob", async () => {
    const socket = new FakeSocket();
    const run = listen(socket);
    const bytes = (event: unknown) => new TextEncoder().encode(JSON.stringify(event));
    socket.send(bytes(META).buffer);
    socket.send(bytes(PATCH_1));
    socket.send(new Blob([JSON.stringify(PATCH_2)]));
    socket.sendEvent(COMPLETE);
    await run.done;
    // Order is the order of arrival, even though the Blob decodes asynchronously.
    expect(run.events.map((e) => e.type)).toEqual(["meta", "patch", "patch", "complete"]);
  });
});

// --- stream and document (T-213) ---------------------------------------------

describe("stream source (T-213)", () => {
  it("reads SSE framing from any ReadableStream", async () => {
    const { events, error } = await collect({ stream: sse([META, PATCH_1, COMPLETE].map(data)) });
    expect(error).toBeUndefined();
    expect(events.map((e) => e.type)).toEqual(["meta", "patch", "complete"]);
  });

  it("reports an incomplete document when the stream ends early", async () => {
    const { events, error } = await collect({ stream: sse([META, PATCH_1].map(data)) });
    expect(events.map((e) => e.type)).toEqual(["meta", "patch"]);
    expect((error as RelaxUIError).code).toBe("truncated");
  });

  it("refuses an event longer than the limit, ended or not, with stream_malformed (T-446)", async () => {
    const long = "x".repeat(DEFAULT_MAX_EVENT_LENGTH + 1);
    // A long event that never ends: refused while it is still arriving.
    const unended = await collect({ stream: sse([data(META), `data: ${long}`]) });
    expect((unended.error as RelaxUIError).code).toBe("stream_malformed");
    // One that ends: refused, not parsed.
    const ended = await collect({ stream: sse([data(META), data({ pad: long }), data(COMPLETE)]) });
    expect((ended.error as RelaxUIError).code).toBe("stream_malformed");
    expect(ended.events.map((e) => e.type)).toEqual(["meta"]);
    // The limit is configurable where the decoder is used directly.
    const events: string[] = [];
    await expect(
      (async () => {
        for await (const e of decodeSSE(sse([data(12345678901)]), undefined, { maxEventLength: 10 })) events.push(e.data);
      })(),
    ).rejects.toMatchObject({ code: "stream_malformed" });
  });

  it("an error frame is a proper ending, not a truncation", async () => {
    const { events, error } = await collect({ stream: sse([PATCH_1, ERROR].map(data)) });
    expect(events.map((e) => e.type)).toEqual(["patch", "error"]);
    expect(error).toBeUndefined();
  });
});

describe("document source (T-213)", () => {
  it("yields the whole document as one snapshot", async () => {
    const document = { root: { type: "Text", props: { text: "hello" } } };
    const { events, error } = await collect({ document });
    expect(error).toBeUndefined();
    expect(events).toEqual([{ type: "snapshot", seq: 1, value: document }]);
    const accumulator = new UIStreamAccumulator();
    events.forEach((e) => accumulator.apply(e));
    expect(accumulator.current()).toEqual(document);
  });

  it("does not share the caller's object with the renderer", async () => {
    const document = { root: { type: "Text", props: { text: "hello" } } };
    const { events } = await collect({ document });
    const value = (events[0] as { value: typeof document }).value;
    expect(value).not.toBe(document);
    document.root.props.text = "changed after the fact";
    expect(value.root.props.text).toBe("hello");
  });

  it("refuses a value that is not JSON", async () => {
    const { error } = await collect({ document: { when: new Date(0), f: () => 1 } as unknown as object });
    expect((error as RelaxUIError).code).toBe("config_invalid");
  });
});

describe("sourceKind", () => {
  it.each([
    [{ document: {} }, "document"],
    [{ url: "/api/ui" }, "url"],
    [{ stream: sse([]) }, "stream"],
    [{ socket: new FakeSocket() }, "socket"],
  ] as const)("names %o", (source, kind) => {
    expect(sourceKind(source as Source)).toBe(kind);
  });

  it.each([{}, { url: "/a", document: {} }, { url: 42 }, { stream: "nope" }, { socket: {} }, null])(
    "refuses %o",
    (source) => {
      expect(() => sourceKind(source as unknown as Source)).toThrowError(
        expect.objectContaining({ code: "config_invalid" }),
      );
    },
  );
});
