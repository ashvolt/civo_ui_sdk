import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineStructuredSchema } from "../src/schema/define.js";
import { toJsonSchema } from "../src/schema/json-schema.js";
import type { JsonObject } from "../src/types.js";

describe("toJsonSchema", () => {
  it("emits an object with required keys and closed additionalProperties", () => {
    const schema = toJsonSchema(z.object({ a: z.string(), b: z.number().optional() }));
    expect(schema["type"]).toBe("object");
    expect(schema["required"]).toEqual(["a"]);
    expect(schema["additionalProperties"]).toBe(false);
  });

  it("marks every property required in strict mode", () => {
    const schema = toJsonSchema(z.object({ a: z.string(), b: z.number().optional() }), {
      strict: true,
    });
    expect(schema["required"]).toEqual(["a", "b"]);
  });

  it("carries .describe() through as a description", () => {
    const schema = toJsonSchema(z.object({ a: z.string().describe("the a") }));
    const props = schema["properties"] as unknown as JsonObject;
    expect((props["a"] as JsonObject)["description"]).toBe("the a");
  });

  it("translates string constraints", () => {
    const schema = toJsonSchema(z.string().min(2).max(8).regex(/^x/));
    expect(schema["minLength"]).toBe(2);
    expect(schema["maxLength"]).toBe(8);
    expect(schema["pattern"]).toBe("^x");
  });

  it("translates numeric constraints and integer-ness", () => {
    const schema = toJsonSchema(z.number().int().min(1).max(10));
    expect(schema["type"]).toBe("integer");
    expect(schema["minimum"]).toBe(1);
    expect(schema["maximum"]).toBe(10);
  });

  it("emits const for a literal and enum for an enum", () => {
    expect(toJsonSchema(z.literal("a"))["const"]).toBe("a");
    expect(toJsonSchema(z.enum(["a", "b"]))["enum"]).toEqual(["a", "b"]);
  });

  it("wraps nullable in anyOf with null", () => {
    expect(toJsonSchema(z.string().nullable())["anyOf"]).toEqual([{ type: "string" }, { type: "null" }]);
  });

  it("emits anyOf plus a discriminator hint for discriminated unions", () => {
    const schema = toJsonSchema(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("a"), a: z.string() }),
        z.object({ kind: z.literal("b"), b: z.number() }),
      ]),
    );
    expect(Array.isArray(schema["anyOf"])).toBe(true);
    expect(schema["discriminator"]).toEqual({ propertyName: "kind" });
  });

  it("represents arrays with item schemas and length bounds", () => {
    const schema = toJsonSchema(z.array(z.string()).min(1).max(3));
    expect(schema["type"]).toBe("array");
    expect(schema["items"]).toEqual({ type: "string" });
    expect(schema["minItems"]).toBe(1);
    expect(schema["maxItems"]).toBe(3);
  });

  it("breaks recursion with $defs and $ref rather than hanging", () => {
    interface Node {
      value: string;
      children?: Node[];
    }
    const node: z.ZodType<Node> = z.lazy(() =>
      z.object({ value: z.string(), children: z.array(node).optional() }),
    );

    const schema = toJsonSchema(node, { name: "Node" });
    const defs = schema["$defs"] as unknown as JsonObject;
    expect(defs).toBeDefined();
    const serialised = JSON.stringify(schema);
    expect(serialised).toContain("$ref");
    // The recursive reference must point at a definition that actually exists.
    const refName = /#\/\$defs\/([A-Za-z0-9_]+)/.exec(serialised)?.[1] as string;
    expect(defs[refName]).toBeDefined();
  });

  it("refuses constructs it cannot represent instead of emitting a lie", () => {
    expect(() => toJsonSchema(z.map(z.string(), z.string()))).toThrowError(/no JSON Schema representation/);
  });
});

describe("defineStructuredSchema", () => {
  it("derives a JSON Schema from the Zod schema", () => {
    const structured = defineStructuredSchema({
      name: "Card",
      schema: z.object({ title: z.string() }),
    });
    expect(structured.jsonSchema["type"]).toBe("object");
  });

  it("accepts a caller-supplied JSON Schema as an escape hatch", () => {
    const structured = defineStructuredSchema({
      name: "Custom",
      schema: z.object({ title: z.string() }),
      jsonSchema: { type: "object", properties: { title: { type: "string" } } },
    });
    expect(structured.jsonSchema["properties"]).toEqual({ title: { type: "string" } });
  });

  it("rejects names the API would reject", () => {
    expect(() =>
      defineStructuredSchema({ name: "not a name!", schema: z.object({}) }),
    ).toThrowError(/is invalid/);
  });
});
