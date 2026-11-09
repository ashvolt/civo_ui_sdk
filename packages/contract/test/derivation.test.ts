import { createUIRegistry, toJsonSchema } from "relax-ui-core";
import { standardContract } from "relax-ui-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * T-222. The contract is the single source for both sides (FR-211, C3): the
 * JSON Schema the server sends a model and the schema the browser validates
 * against come from one declaration, so they cannot disagree.
 */
describe("server and browser derive from one contract (T-222)", () => {
  const extended = standardContract.extend(
    { Timeline: { description: "Events.", role: "list", children: "none", props: z.object({ events: z.array(z.string()).max(5) }) } },
    { maxNodes: 80, maxDepth: 6 },
  );

  it.each([
    ["standard", standardContract],
    ["extended", extended],
  ])("%s: the server registry's JSON Schema equals the browser contract's", (_name, contract) => {
    const registry = createUIRegistry(contract.specs, contract.limits);
    expect(toJsonSchema(registry.documentSchema, { name: "Doc" })).toEqual(
      toJsonSchema(contract.documentSchema, { name: "Doc" }),
    );
    expect(registry.limits).toEqual(contract.limits);
    expect([...registry.names].sort()).toEqual([...contract.names].sort());
  });

  it("the model is told every component and its description", () => {
    const registry = createUIRegistry(extended.specs, extended.limits);
    const json = JSON.stringify(registry.structuredSchema("Dashboard").jsonSchema);
    for (const name of extended.names) {
      expect(json).toContain(`"${name}"`);
      expect(json).toContain(extended.spec(name)!.description!);
    }
  });

  it("server and browser agree on every verdict for the same documents", () => {
    const registry = createUIRegistry(extended.specs, extended.limits);
    const docs = [
      { root: { type: "Stack", props: {}, children: [{ type: "Text", props: { text: "x" } }] } },
      { root: { type: "Timeline", props: { events: ["a"] } } },
      { root: { type: "Timeline", props: { events: ["a", "b", "c", "d", "e", "f"] } } },
      { root: { type: "Link", props: { label: "x", href: "javascript:alert(1)" } } },
      { root: { type: "Unknown", props: {} } },
    ];
    for (const d of docs) {
      expect(registry.documentSchema.safeParse(d).success, JSON.stringify(d)).toBe(
        extended.documentSchema.safeParse(d).success,
      );
    }
  });
});
