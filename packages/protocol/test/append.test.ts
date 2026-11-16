import {
  applyPatch,
  diffJson,
  negotiateProtocol,
  readSource,
  RelaxUIError,
  UI_STREAM_ACCEPT,
  UIStreamAccumulator,
  type JsonPatchOp,
  type JsonValue,
  type UIStreamEvent,
} from "relax-ui-protocol";
import { describe, expect, it } from "vitest";

/** Spec 002, T-159: protocol 2's `append`, and how a client asks for it. */

describe("diffJson with append (protocol 2)", () => {
  it("sends a string that only grew as append of what it gained", () => {
    const before = { title: "Q3 rev", items: ["one", "tw"] };
    const after = { title: "Q3 revenue", items: ["one", "two"] };
    expect(diffJson(before, after, [], { append: true })).toEqual([
      { op: "append", path: "/title", value: "enue" },
      { op: "append", path: "/items/1", value: "o" },
    ]);
  });

  it("replaces a string that changed in any other way", () => {
    expect(diffJson({ t: "abc" }, { t: "abd" }, [], { append: true })).toEqual([{ op: "replace", path: "/t", value: "abd" }]);
    expect(diffJson({ t: "abc" }, { t: "ab" }, [], { append: true })).toEqual([{ op: "replace", path: "/t", value: "ab" }]);
  });

  it("protocol 1 (no option) never sends append", () => {
    expect(diffJson({ t: "ab" }, { t: "abc" })).toEqual([{ op: "replace", path: "/t", value: "abc" }]);
  });
});

describe("applying append", () => {
  it("extends a string in an object, in an array and at the root", () => {
    expect(applyPatch({ a: { t: "he" } }, [{ op: "append", path: "/a/t", value: "llo" }])).toEqual({ a: { t: "hello" } });
    expect(applyPatch(["x", "he"], [{ op: "append", path: "/1", value: "y" }])).toEqual(["x", "hey"]);
    expect(applyPatch("he", [{ op: "append", path: "", value: "y" }])).toBe("hey");
  });

  it("refuses a target that is not a string, and the accumulator says the stream is malformed", () => {
    for (const doc of [{ t: 3 }, { t: ["a"] }, {}] as JsonValue[]) {
      expect(() => applyPatch(doc, [{ op: "append", path: "/t", value: "x" }]), JSON.stringify(doc)).toThrow(/append needs a string/);
    }
    const acc = new UIStreamAccumulator();
    acc.apply({ type: "patch", seq: 1, ops: [{ op: "add", path: "", value: { n: 1 } }] });
    let error: unknown;
    try {
      acc.apply({ type: "patch", seq: 2, ops: [{ op: "append", path: "/n", value: "x" }] });
    } catch (e) {
      error = e;
    }
    expect((error as RelaxUIError).code).toBe("stream_malformed");
    expect(acc.current()).toEqual({ n: 1 });
  });

  it("builds the same document as protocol 1, frame by frame", () => {
    const frames = ["", "A", "A long", "A long title", "A long title that grows"].map((t, i) => ({ title: t, n: i }));
    const v1 = new UIStreamAccumulator();
    const v2 = new UIStreamAccumulator();
    let prev: unknown;
    frames.forEach((f, i) => {
      v1.apply({ type: "patch", seq: i + 1, ops: diffJson(prev as never, f) });
      v2.apply({ type: "patch", seq: i + 1, ops: diffJson(prev as never, f, [], { append: true }) });
      prev = f;
      expect(v2.current()).toEqual(v1.current());
    });
  });
});

describe("what append saves (the T-159 measurement)", () => {
  it("a 304-character text written a few characters a frame costs a fraction of the bytes", () => {
    // As measured on the bench: one Prose text of 304 characters in 55 frames.
    const text = "Sovereign inference keeps prompts and outputs inside UK jurisdiction. ".repeat(5).slice(0, 304);
    const step = Math.ceil(text.length / 55);
    const bytes = (append: boolean) => {
      let prev: unknown;
      let total = 0;
      for (let end = step; end < text.length + step; end += step) {
        const doc = { type: "Prose", props: { text: text.slice(0, end) } };
        const ops: JsonPatchOp[] = diffJson(prev as never, doc as never, [], { append });
        total += JSON.stringify(ops).length;
        prev = doc;
      }
      return total;
    };
    const v1 = bytes(false);
    const v2 = bytes(true);
    // Quadratic against linear: 10,523 characters of ops against 2,823 here (51 frames).
    expect(v2).toBeLessThan(v1 / 3);
  });
});

describe("negotiating the protocol", () => {
  it("answers 2 only to a client whose Accept asks for it", () => {
    expect(negotiateProtocol(UI_STREAM_ACCEPT)).toBe(2);
    expect(negotiateProtocol("text/event-stream; relax-ui-stream=2")).toBe(2);
    expect(negotiateProtocol('text/event-stream;relax-ui-stream="3", */*')).toBe(2);
    for (const accept of [null, undefined, "", "*/*", "text/event-stream", "text/event-stream; relax-ui-stream=1", "x-relax-ui-stream=2"]) {
      expect(negotiateProtocol(accept), String(accept)).toBe(1);
    }
  });

  it("the browser's reader says it reads protocol 2, in Accept, which CORS lets through without a preflight entry", async () => {
    let accept: string | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      accept = new Headers(init.headers).get("accept");
      const body = 'data: {"type":"complete","value":{},"metadata":{"requestId":"r","model":"m","strategy":"tool_call","downgradedFrom":[],"repairAttempts":0,"durationMs":1}}\n\n';
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const events: UIStreamEvent[] = [];
    for await (const e of readSource({ url: "/api/ui" }, { fetch: fetchImpl, body: {} })) events.push(e);
    expect(accept).toBe(UI_STREAM_ACCEPT);
    expect(events.at(-1)?.type).toBe("complete");
  });

  it("a client refuses a protocol newer than it reads, rather than misapplying its ops", () => {
    const acc = new UIStreamAccumulator();
    expect(() => acc.apply({ type: "meta", protocol: 3 as never, requestId: "r", model: "m", schema: "S", strategy: "tool_call" })).toThrow(
      /protocol 3/,
    );
    expect(() => acc.apply({ type: "meta", protocol: 1, requestId: "r", model: "m", schema: "S", strategy: "tool_call" })).not.toThrow();
  });
});
