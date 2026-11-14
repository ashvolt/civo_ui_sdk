import { decodeSSE, RelaxUIError, type SSEEvent } from "relax-ui-protocol";
import { describe, expect, it } from "vitest";

/** A body that hands over each string as its own chunk, then closes (or stays open). */
function body(chunks: readonly string[], open = false): { stream: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      if (!open) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

async function all(stream: ReadableStream<Uint8Array>, idleTimeoutMs?: number): Promise<SSEEvent[]> {
  const out: SSEEvent[] = [];
  for await (const e of decodeSSE(stream, undefined, idleTimeoutMs ? { idleTimeoutMs } : {})) out.push(e);
  return out;
}

describe("line endings (the SSE specification: CRLF, LF or a bare CR)", () => {
  it("reads events separated by bare carriage returns", async () => {
    const events = await all(body(["data: one\r\r", "event: x\rdata: two\r\r"]).stream);
    expect(events).toEqual([{ data: "one" }, { event: "x", data: "two" }]);
  });

  it("reads a CRLF split across two chunks as one line ending, not two", async () => {
    // "data: a\r" | "\n" | "data: b\r\n\r\n": one event with two data lines.
    const events = await all(body(["data: a\r", "\ndata: b\r\n\r", "\n"]).stream);
    expect(events).toEqual([{ data: "a\nb" }]);
  });

  it("reads every ending mixed in one stream, LF and CRLF as before", async () => {
    const events = await all(body(["data: lf\n\n", "data: crlf\r\n\r\n", "data: cr\r\r", "data: tail"]).stream);
    expect(events.map((e) => e.data)).toEqual(["lf", "crlf", "cr", "tail"]);
  });

  it("keeps a multi-line event's lines when they end in bare carriage returns", async () => {
    const events = await all(body(["data: {\"a\":\rdata: 1}\r\r"]).stream);
    expect(events).toEqual([{ data: '{"a":\n1}' }]);
  });
});

describe("an idle stream (spec 002, T-160)", () => {
  it("is closed with a retryable timeout after the idle limit, and its body cancelled", async () => {
    const b = body(["data: first\n\n"], true);
    const seen: string[] = [];
    let error: unknown;
    const started = Date.now();
    try {
      for await (const e of decodeSSE(b.stream, undefined, { idleTimeoutMs: 60 })) seen.push(e.data);
    } catch (e) {
      error = e;
    }
    expect(seen).toEqual(["first"]);
    expect(error).toBeInstanceOf(RelaxUIError);
    expect((error as RelaxUIError).code).toBe("timeout");
    expect((error as RelaxUIError).retryable).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(b.cancelled()).toBe(true);
  });

  it("is not closed while bytes keep arriving, however long the whole stream takes", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Six events 30 ms apart: 180 ms in all, never 60 ms of silence.
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 30));
          controller.enqueue(encoder.encode(`data: ${i}\n\n`));
        }
        controller.close();
      },
    });
    const events = await all(stream, 60);
    expect(events.map((e) => e.data)).toEqual(["0", "1", "2", "3", "4", "5"]);
  });

  it("without a limit, waits as before", async () => {
    const b = body(["data: first\n\n"], true);
    const stop = new AbortController();
    const it = decodeSSE(b.stream, stop.signal);
    expect((await it.next()).value).toEqual({ data: "first" });
    const next = it.next();
    const winner = await Promise.race([next.then(() => "event", () => "error"), new Promise((r) => setTimeout(() => r("still waiting"), 100))]);
    expect(winner).toBe("still waiting");
    // Only the caller's own signal ends it.
    stop.abort();
    await next.catch(() => undefined);
    expect(b.cancelled()).toBe(true);
  });
});
