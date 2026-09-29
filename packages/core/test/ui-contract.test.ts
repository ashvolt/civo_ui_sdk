import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createUIRegistry, displayText, measureTree, urlString, type UINode } from "../src/ui/contract.js";

const registry = createUIRegistry(
  {
    Stack: {
      description: "Vertical layout container.",
      props: z.object({ gap: z.enum(["sm", "md", "lg"]).default("md") }),
      children: "required",
    },
    Metric: {
      description: "A single labelled number.",
      props: z.object({ label: displayText(80), value: z.number(), unit: z.string().optional() }),
    },
    Link: {
      props: z.object({ label: displayText(80), href: urlString() }),
    },
  },
  { maxNodes: 10, maxDepth: 3 },
);

const metric = (label: string, value: number): UINode => ({
  type: "Metric",
  props: { label, value },
});

describe("createUIRegistry", () => {
  it("accepts a document built from registered components", () => {
    const result = registry.documentSchema.safeParse({
      root: { type: "Stack", props: { gap: "lg" }, children: [metric("ARR", 12)] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a component the application never registered", () => {
    const result = registry.documentSchema.safeParse({
      root: { type: "IframeEscapeHatch", props: { src: "https://evil.example" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects props that do not match the component", () => {
    const result = registry.documentSchema.safeParse({
      root: { type: "Metric", props: { label: "ARR", value: "twelve" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects extra props rather than passing them through to the DOM", () => {
    const result = registry.documentSchema.safeParse({
      root: { type: "Metric", props: { label: "ARR", value: 1 }, onClick: "alert(1)" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a javascript: URL at validation time, before any render", () => {
    const result = registry.documentSchema.safeParse({
      root: { type: "Link", props: { label: "click", href: "javascript:alert(1)" } },
    });
    expect(result.success).toBe(false);
  });

  it("normalises an accepted URL through the guard", () => {
    const result = registry.documentSchema.safeParse({
      root: { type: "Link", props: { label: "docs", href: "https://civo.com/ai" } },
    });
    expect(result.success).toBe(true);
    const root = (result as { data: { root: UINode } }).data.root;
    expect(root.props["href"]).toBe("https://civo.com/ai");
  });

  it("rejects control characters in display text", () => {
    const result = registry.documentSchema.safeParse({
      root: { type: "Metric", props: { label: "AR\u0007R", value: 1 } },
    });
    expect(result.success).toBe(false);
  });

  it("enforces the node budget", () => {
    const children = Array.from({ length: 12 }, (_, i) => metric(`m${i}`, i));
    const result = registry.documentSchema.safeParse({
      root: { type: "Stack", props: {}, children },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("the limit is 10");
  });

  it("enforces the depth budget", () => {
    let node: UINode = metric("leaf", 0);
    for (let i = 0; i < 5; i++) node = { type: "Stack", props: {}, children: [node] };
    const result = registry.documentSchema.safeParse({ root: node });
    expect(result.success).toBe(false);
  });

  it("requires children where the spec says they are required", () => {
    expect(registry.documentSchema.safeParse({ root: { type: "Stack", props: {}, children: [] } }).success).toBe(false);
  });

  it("forbids children where the spec says the component is a leaf", () => {
    const result = registry.documentSchema.safeParse({
      root: { type: "Metric", props: { label: "a", value: 1 }, children: [metric("b", 2)] },
    });
    expect(result.success).toBe(false);
  });

  it("derives a structured schema whose JSON Schema names every component", () => {
    const structured = registry.structuredSchema("Dashboard");
    const serialised = JSON.stringify(structured.jsonSchema);
    for (const name of ["Stack", "Metric", "Link"]) expect(serialised).toContain(name);
    // Recursion must be expressed as a reference, not expanded forever.
    expect(serialised).toContain("$ref");
    expect(structured.description).toContain("Stack, Metric, Link");
  });
});

describe("measureTree", () => {
  it("counts nodes and depth", () => {
    const tree: UINode = {
      type: "Stack",
      props: {},
      children: [metric("a", 1), { type: "Stack", props: {}, children: [metric("b", 2)] }],
    };
    expect(measureTree(tree)).toEqual({ nodes: 4, depth: 3 });
  });

  it("survives a tree deep enough to overflow a recursive walk", () => {
    let node: UINode = metric("leaf", 0);
    for (let i = 0; i < 200_000; i++) node = { type: "Stack", props: {}, children: [node] };
    // The guard must return, not blow the stack: that is the whole point of it.
    expect(() => measureTree(node)).not.toThrow();
  });

  it("handles a missing root", () => {
    expect(measureTree(undefined)).toEqual({ nodes: 0, depth: 0 });
  });
});
