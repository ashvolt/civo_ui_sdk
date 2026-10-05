import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adaptJsonSchema } from "../src/schema/dialect.js";
import { defineStructuredSchema } from "../src/schema/define.js";
import { createUIRegistry, displayText } from "../src/ui/contract.js";
import type { JsonSchema } from "../src/types.js";

/**
 * Schema dialects (feature 002, FR-111/112).
 *
 * The failure this exists for is silent: a server accepts a schema, answers
 * 200 and enforces nothing because one keyword defeated its grammar compiler.
 * So the tests are about removing exactly that keyword — and, just as much,
 * about what must *not* be removed.
 */
const NO_PATTERN = { unsupportedKeywords: ["pattern"] };

describe("adaptJsonSchema", () => {
  it("returns the same object when there is nothing to adapt", () => {
    const schema: JsonSchema = { type: "object", properties: { a: { type: "string" } } };
    expect(adaptJsonSchema(schema).schema).toBe(schema);
    expect(adaptJsonSchema(schema, { unsupportedKeywords: [] }).schema).toBe(schema);
    // The dialect names a keyword this schema never uses.
    const result = adaptJsonSchema(schema, NO_PATTERN);
    expect(result.schema).toBe(schema);
    expect(result.dropped).toEqual([]);
  });

  it("removes the keyword wherever a schema can appear", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        title: { type: "string", pattern: "^a", maxLength: 10 },
        tags: { type: "array", items: { type: "string", pattern: "^b" } },
        choice: { anyOf: [{ type: "string", pattern: "^c" }, { type: "number" }] },
      },
      $defs: { Node: { type: "string", pattern: "^d" } },
    };
    const { schema: out, dropped } = adaptJsonSchema(schema, NO_PATTERN);

    expect(JSON.stringify(out)).not.toContain('"pattern"');
    expect(dropped).toEqual(["pattern"]);
    // Everything else survives, so the server still enforces what it can.
    expect(JSON.stringify(out)).toContain('"maxLength":10');
    expect(JSON.stringify(out)).toContain('"$defs"');
  });

  it("keeps an application property that happens to be called `pattern`", () => {
    // The trap in a naive key filter: `pattern` is a keyword in a schema object
    // and an ordinary name inside `properties`.
    const schema: JsonSchema = {
      type: "object",
      properties: {
        pattern: { type: "string", pattern: "^[a-z]+$", description: "A regex the user typed." },
      },
      required: ["pattern"],
    };
    const { schema: out, dropped } = adaptJsonSchema(schema, NO_PATTERN);

    expect(out).toEqual({
      type: "object",
      properties: { pattern: { type: "string", description: "A regex the user typed." } },
      required: ["pattern"],
    });
    expect(dropped).toEqual(["pattern"]);
  });

  it("does not rewrite data that merely looks like a schema", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        config: {
          const: { pattern: "keep me" },
          default: { pattern: "and me" },
          enum: [{ pattern: "and me too" }],
        },
      },
    };
    const { schema: out } = adaptJsonSchema(schema, NO_PATTERN);
    expect(out).toEqual(schema);
  });

  it("does not mutate its input", () => {
    const schema: JsonSchema = { type: "string", pattern: "^a" };
    const before = JSON.stringify(schema);
    adaptJsonSchema(schema, NO_PATTERN);
    expect(JSON.stringify(schema)).toBe(before);
  });

  it("reports every dropped keyword once, sorted", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        a: { type: "string", pattern: "x", format: "email" },
        b: { type: "string", pattern: "y" },
      },
    };
    expect(adaptJsonSchema(schema, { unsupportedKeywords: ["pattern", "format", "unused"] }).dropped).toEqual([
      "format",
      "pattern",
    ]);
  });
});

describe("a UI registry adapted for Ollama", () => {
  const registry = createUIRegistry({
    Stack: {
      description: "Container.",
      props: z.object({ heading: displayText(80).optional() }),
      children: "required",
    },
    Metric: {
      description: "A number.",
      props: z.object({ label: displayText(40), value: displayText(24) }),
    },
  });
  const schema = registry.structuredSchema("Doc", "A document.");

  it("starts from a schema that does carry the keyword", () => {
    // `displayText` guards control characters with a `pattern`. If this ever
    // stops being true the Ollama dialect has nothing to do and should go.
    expect(JSON.stringify(schema.jsonSchema)).toContain('"pattern"');
  });

  it("loses `pattern` and keeps its structure, recursion and limits", () => {
    const { schema: wire, dropped } = adaptJsonSchema(schema.jsonSchema, NO_PATTERN);
    const text = JSON.stringify(wire);

    expect(dropped).toEqual(["pattern"]);
    expect(text).not.toContain('"pattern"');
    expect(text).toContain('"$ref"');
    expect(text).toContain('"maxLength":24');
    expect(text).toContain('"const":"Metric"');
    expect(text).toContain('"additionalProperties":false');
  });

  it("leaves the validator exactly as strict as it was", () => {
    // FR-112: adaptation changes what the model is told, never what is
    // accepted. A control character the dropped `pattern` would have prevented
    // is still refused — by us.
    adaptJsonSchema(schema.jsonSchema, NO_PATTERN);
    const bad = { root: { type: "Metric", props: { label: "ok", value: "bell\u0007" } } };
    const good = { root: { type: "Metric", props: { label: "ok", value: "38%" } } };
    expect(schema.schema.safeParse(bad).success).toBe(false);
    expect(schema.schema.safeParse(good).success).toBe(true);
  });
});

describe("defineStructuredSchema", () => {
  it("is untouched by adaptation of its JSON Schema", () => {
    const structured = defineStructuredSchema({
      name: "Slug",
      schema: z.object({ slug: z.string().regex(/^[a-z-]+$/) }),
    });
    const before = JSON.stringify(structured.jsonSchema);
    const { schema: wire } = adaptJsonSchema(structured.jsonSchema, NO_PATTERN);
    expect(JSON.stringify(structured.jsonSchema)).toBe(before);
    expect(wire).not.toBe(structured.jsonSchema);
  });
});
