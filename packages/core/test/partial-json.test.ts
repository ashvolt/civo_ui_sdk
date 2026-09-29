import { describe, expect, it } from "vitest";
import { completePartialJson, parsePartialJson } from "../src/stream/partial-json.js";

describe("completePartialJson", () => {
  it("closes an object that is still open", () => {
    expect(completePartialJson('{"a":1')).toBe('{"a":1}');
  });

  it("keeps a half-written value string and closes it", () => {
    expect(completePartialJson('{"title":"Quarterly rev')).toBe('{"title":"Quarterly rev"}');
  });

  it("discards a half-written key rather than inventing one", () => {
    expect(completePartialJson('{"a":1,"ti')).toBe('{"a":1}');
  });

  it("rewinds a dangling comma", () => {
    expect(completePartialJson('{"a":1,')).toBe('{"a":1}');
  });

  it("rewinds a key whose value has not started", () => {
    expect(completePartialJson('{"a":1,"b":')).toBe('{"a":1}');
  });

  it("rewinds an incomplete literal", () => {
    expect(completePartialJson('{"ok":tru')).toBe("{}");
  });

  it("keeps a completed literal", () => {
    expect(completePartialJson('{"ok":true')).toBe('{"ok":true}');
  });

  it("rewinds a number that cannot terminate yet", () => {
    expect(completePartialJson('{"n":1.2e')).toBe("{}");
    expect(completePartialJson('{"n":-')).toBe("{}");
  });

  it("keeps a number that is already valid", () => {
    expect(completePartialJson('{"n":12')).toBe('{"n":12}');
    expect(completePartialJson('{"n":-1.5e+3')).toBe('{"n":-1.5e+3}');
  });

  it("closes nested structures innermost-first", () => {
    expect(completePartialJson('{"a":{"b":[1,2')).toBe('{"a":{"b":[1,2]}}');
  });

  it("drops a dangling escape so the closing quote stays valid", () => {
    expect(completePartialJson('{"s":"a\\')).toBe('{"s":"a"}');
  });

  it("drops an incomplete unicode escape", () => {
    expect(completePartialJson('{"s":"a\\u00')).toBe('{"s":"a"}');
  });

  it("preserves a complete escape", () => {
    expect(completePartialJson('{"s":"a\\u0041')).toBe('{"s":"a\\u0041"}');
  });

  it("does not mistake structural characters inside strings", () => {
    expect(completePartialJson('{"s":"}{[,:')).toBe('{"s":"}{[,:"}');
  });

  it("handles arrays of objects mid-element", () => {
    expect(completePartialJson('[{"a":1},{"b"')).toBe('[{"a":1},{}]');
  });

  it("returns null when nothing usable has arrived", () => {
    expect(completePartialJson("")).toBeNull();
    expect(completePartialJson("   ")).toBeNull();
  });

  it("rejects structurally impossible input instead of guessing", () => {
    expect(completePartialJson('{"a":1}]')).toBeNull();
    expect(completePartialJson('{"a" 1}')).toBeNull();
  });
});

describe("parsePartialJson", () => {
  it("reports a complete document as complete", () => {
    const result = parsePartialJson('{"a":1}');
    expect(result.state).toBe("complete");
    expect(result.value).toEqual({ a: 1 });
  });

  it("reports empty input", () => {
    expect(parsePartialJson("").state).toBe("empty");
  });

  it("produces a growing value as tokens arrive", () => {
    const full = '{"title":"Revenue","items":[{"label":"Q1","value":42}]}';
    const seen: unknown[] = [];
    for (let i = 1; i <= full.length; i++) {
      const result = parsePartialJson(full.slice(0, i));
      if (result.state === "partial" || result.state === "complete") seen.push(result.value);
    }
    // Every prefix that parses at all must parse to an object, and the last one
    // must be the real document.
    expect(seen.length).toBeGreaterThan(10);
    for (const value of seen) expect(typeof value).toBe("object");
    expect(seen.at(-1)).toEqual(JSON.parse(full));
  });

  it("never throws on arbitrary prefixes of a realistic document", () => {
    const doc = JSON.stringify({
      root: {
        type: "Card",
        props: { title: 'He said "hi"\nthen left', ratio: -0.5 },
        children: [{ type: "Metric", props: { label: "ARR", value: 1.2e6 } }],
      },
    });
    for (let i = 0; i <= doc.length; i++) {
      expect(() => parsePartialJson(doc.slice(0, i))).not.toThrow();
    }
  });
});
