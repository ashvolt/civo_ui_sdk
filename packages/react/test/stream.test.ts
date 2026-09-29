import { UIStreamAccumulator, type UIStreamEvent } from "@civo/relax-ui-core";
import { describe, expect, it } from "vitest";
import { readUIStream } from "../src/stream.js";

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

const data = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

async function drain<T>(body: ReadableStream<Uint8Array>): Promise<UIStreamEvent<T>[]> {
  const out: UIStreamEvent<T>[] = [];
  for await (const event of readUIStream<T>(body)) out.push(event);
  return out;
}

describe("readUIStream", () => {
  it("decodes a well-formed stream", async () => {
    const events = await drain(
      sseBody([
        data({ type: "meta", protocol: 1, requestId: "r", model: "m", schema: "S", strategy: "tool_call" }),
        data({ type: "patch", seq: 1, ops: [{ op: "add", path: "/a", value: 1 }] }),
        data({ type: "complete", value: { a: 1 }, metadata: {} }),
        "data: [DONE]\n\n",
      ]),
    );
    expect(events.map((e) => e.type)).toEqual(["meta", "patch", "complete"]);
  });

  it("stops at the terminator and ignores anything after it", async () => {
    const events = await drain(
      sseBody(["data: [DONE]\n\n", data({ type: "patch", seq: 1, ops: [] })]),
    );
    expect(events).toHaveLength(0);
  });

  it("survives frames split across chunk boundaries", async () => {
    const frame = data({ type: "patch", seq: 1, ops: [{ op: "add", path: "/a", value: "long value" }] });
    const midpoint = Math.floor(frame.length / 2);
    const events = await drain(sseBody([frame.slice(0, midpoint), frame.slice(midpoint)]));
    expect(events).toHaveLength(1);
  });

  it("drops keep-alive comments and blank frames instead of dying", async () => {
    const events = await drain(
      sseBody([": keep-alive\n\n", "\n\n", data({ type: "patch", seq: 1, ops: [] })]),
    );
    expect(events).toHaveLength(1);
  });

  it("drops frames that are not JSON", async () => {
    const events = await drain(sseBody(["data: not json at all\n\n", data({ type: "patch", seq: 1, ops: [] })]));
    expect(events).toHaveLength(1);
  });

  it("drops JSON that is not an SDK event", async () => {
    const events = await drain(sseBody([data({ hello: "world" }), data({ type: "patch", seq: 1, ops: [] })]));
    expect(events).toHaveLength(1);
  });

  it("handles CRLF line endings", async () => {
    const events = await drain(
      sseBody([`data: ${JSON.stringify({ type: "patch", seq: 1, ops: [] })}\r\n\r\n`]),
    );
    expect(events).toHaveLength(1);
  });

  it("rebuilds the document exactly when folded through the accumulator", async () => {
    const events = await drain(
      sseBody([
        data({ type: "meta", protocol: 1, requestId: "r", model: "m", schema: "S", strategy: "tool_call" }),
        data({ type: "patch", seq: 1, ops: [{ op: "add", path: "/title", value: "Q" }] }),
        data({ type: "patch", seq: 2, ops: [{ op: "replace", path: "/title", value: "Q1" }, { op: "add", path: "/score", value: 3 }] }),
        data({ type: "complete", value: { title: "Q1", score: 3 }, metadata: {} }),
      ]),
    );

    const accumulator = new UIStreamAccumulator();
    for (const event of events) accumulator.apply(event);
    expect(accumulator.current()).toEqual({ title: "Q1", score: 3 });
    expect(accumulator.meta()?.strategy).toBe("tool_call");
    expect(accumulator.done).toBe(true);
  });

  it("refuses to render a mixture when frames arrive out of order", async () => {
    const accumulator = new UIStreamAccumulator();
    accumulator.apply({ type: "patch", seq: 1, ops: [{ op: "add", path: "/a", value: 1 }] });
    expect(() =>
      accumulator.apply({ type: "patch", seq: 3, ops: [{ op: "add", path: "/b", value: 2 }] }),
    ).toThrowError(/out of order/);
  });
});
