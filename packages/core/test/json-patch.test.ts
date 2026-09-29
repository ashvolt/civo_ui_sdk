import { describe, expect, it } from "vitest";
import type { JsonValue } from "../src/types.js";
import { applyPatch, diffJson, fromPointer, toPointer } from "../src/stream/json-patch.js";

const roundTrip = (before: JsonValue | undefined, after: JsonValue | undefined) =>
  applyPatch(before, diffJson(before, after));

describe("JSON pointers", () => {
  it("escapes the reserved characters", () => {
    expect(toPointer(["a/b", "c~d", 0])).toBe("/a~1b/c~0d/0");
    expect(fromPointer("/a~1b/c~0d/0")).toEqual(["a/b", "c~d", "0"]);
  });

  it("round-trips the empty path", () => {
    expect(toPointer([])).toBe("");
    expect(fromPointer("")).toEqual([]);
  });
});

describe("diffJson / applyPatch", () => {
  it("adds a new key", () => {
    const ops = diffJson({ a: 1 }, { a: 1, b: 2 });
    expect(ops).toEqual([{ op: "add", path: "/b", value: 2 }]);
    expect(roundTrip({ a: 1 }, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("replaces a scalar", () => {
    expect(diffJson({ a: 1 }, { a: 2 })).toEqual([{ op: "replace", path: "/a", value: 2 }]);
  });

  it("removes a key", () => {
    expect(diffJson({ a: 1, b: 2 }, { a: 1 })).toEqual([{ op: "remove", path: "/b" }]);
    expect(roundTrip({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
  });

  it("appends to an array without rewriting it", () => {
    const ops = diffJson({ xs: [1, 2] }, { xs: [1, 2, 3] });
    expect(ops).toEqual([{ op: "add", path: "/xs/2", value: 3 }]);
  });

  it("truncates an array from the end", () => {
    const ops = diffJson({ xs: [1, 2, 3] }, { xs: [1] });
    // Removing high indices first keeps every remaining index valid.
    expect(ops).toEqual([
      { op: "remove", path: "/xs/2" },
      { op: "remove", path: "/xs/1" },
    ]);
    expect(roundTrip({ xs: [1, 2, 3] }, { xs: [1] })).toEqual({ xs: [1] });
  });

  it("descends into nested structures", () => {
    const before = { root: { type: "Card", children: [{ type: "Text", props: { value: "a" } }] } };
    const after = { root: { type: "Card", children: [{ type: "Text", props: { value: "ab" } }] } };
    expect(diffJson(before, after)).toEqual([
      { op: "replace", path: "/root/children/0/props/value", value: "ab" },
    ]);
  });

  it("round-trips a realistic streaming sequence", () => {
    const frames: JsonValue[] = [
      {},
      { root: {} },
      { root: { type: "Card" } },
      { root: { type: "Card", props: { title: "Rev" } } },
      { root: { type: "Card", props: { title: "Revenue" }, children: [] } },
      { root: { type: "Card", props: { title: "Revenue" }, children: [{ type: "Metric" }] } },
    ];
    let doc: JsonValue | undefined;
    for (const frame of frames) {
      doc = applyPatch(doc, diffJson(doc, frame));
      expect(doc).toEqual(frame);
    }
  });

  it("shares untouched subtrees so referential equality still works", () => {
    const before = { a: { deep: [1, 2, 3] }, b: 1 };
    const after = { a: { deep: [1, 2, 3] }, b: 2 };
    const patched = applyPatch(before, diffJson(before, after)) as typeof before;
    expect(patched.a).toBe(before.a);
    expect(patched).not.toBe(before);
  });

  it("treats null as a value, not an absence", () => {
    expect(diffJson({ a: null }, { a: 1 })).toEqual([{ op: "replace", path: "/a", value: 1 }]);
    expect(diffJson({ a: 1 }, { a: null })).toEqual([{ op: "replace", path: "/a", value: null }]);
  });

  it("replaces the whole document when the root type changes", () => {
    expect(diffJson({ a: 1 }, [1, 2])).toEqual([{ op: "replace", path: "", value: [1, 2] }]);
    expect(roundTrip({ a: 1 }, [1, 2])).toEqual([1, 2]);
  });
});
