import { describe, expect, it } from "vitest";
import { Catalog, MessageProcessor } from "@a2ui/web_core/v0_9";
import { createSpecStreamCompiler } from "@json-render/core";
import { createParser, createLibrary, defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { oursSSE } from "../src/runner/encode.ts";
import { kitApis } from "../src/kit/a2ui.ts";
import { A2UI_CATALOG, A2UI_SURFACE, a2uiJSONL, aiSdkJSON, jsonRenderJSONL, openuiLang, propOrder, toFlatSpec, type FlatSpec } from "../src/runner/contenders.ts";
import { benchContract } from "../src/workloads/contract.ts";
import { framesFor, type Node } from "../src/workloads/generator.ts";
import { LADDERS, planStep } from "../src/workloads/ladders.ts";

/**
 * T-431, T-433, T-434: each contender's encoding of the same frames, decoded
 * by the contender's own code, gives back the same document (plan D3).
 */

const cases = LADDERS.map((l) => ({ id: l.id, frames: framesFor(planStep(l, l.steps[1]!)) }));

describe("json-render: JSONL patches", () => {
  it.each(cases)("$id: its own stream compiler rebuilds every frame", ({ frames }) => {
    const encoded = jsonRenderJSONL(frames);
    if (!("chunks" in encoded)) throw new Error("expressible");
    const compiler = createSpecStreamCompiler<FlatSpec>({ root: "", elements: {} });
    frames.forEach((frame, i) => {
      compiler.push(encoded.chunks[i]!);
      expect(compiler.getResult()).toEqual(toFlatSpec(frame));
    });
  });

  it("writes one element per line, as its prompt asks", () => {
    const encoded = jsonRenderJSONL(cases[0]!.frames) as { chunks: string[] };
    const first = encoded.chunks.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { path: string });
    expect(first.every((op) => op.path === "/root" || op.path.startsWith("/elements/"))).toBe(true);
  });
});

describe("OpenUI Lang: a program written top-down", () => {
  const library = createLibrary({
    components: benchContract.names.map((name) => {
      const props: Record<string, z.ZodType> = {};
      for (const p of propOrder(name)) props[p] = p === "children" ? z.array(z.any()).optional() : z.any().optional();
      return defineComponent({ name, description: name, props: z.object(props), component: () => null });
    }),
    root: "Stack",
  } as never);
  const parser = createParser(library.toJSONSchema(), "Stack");

  /** A parsed element, as our tree: nulls dropped, children in place. */
  const fromParsed = (e: { typeName: string; props: Record<string, unknown> }): Omit<Node, "key"> => {
    const props: Record<string, unknown> = {};
    let children: Omit<Node, "key">[] | undefined;
    for (const [k, v] of Object.entries(e.props)) {
      if (k === "children") children = (v as never[]).map(fromParsed);
      else if (v !== null) props[k] = v;
    }
    return { type: e.typeName, props, ...(children ? { children } : {}) };
  };
  const withoutKeys = (n: Node): Omit<Node, "key"> => ({
    type: n.type,
    props: n.props,
    ...(n.children ? { children: n.children.map(withoutKeys) } : {}),
  });

  it.each(cases)("$id: its own parser reads the whole program as the final document", ({ id, frames }) => {
    const encoded = openuiLang(frames, id);
    if (!("chunks" in encoded)) throw new Error("expressible");
    const result = parser.parse(encoded.chunks.join(""));
    expect(result.meta.errors).toEqual([]);
    expect(fromParsed(result.root as never)).toEqual(withoutKeys(frames.at(-1)!.root));
  });

  it("starts with the root, and writes edits as later statements", () => {
    const churn = cases.find((c) => c.id === "text-churn")!;
    const encoded = openuiLang(churn.frames, "text-churn") as { chunks: string[] };
    expect(encoded.chunks[0]!.startsWith("root = Stack(")).toBe(true);
    const half = churn.frames.length / 2;
    // A churn frame rewrites only changed nodes, not the program.
    const rewrite = encoded.chunks[half]!;
    expect(rewrite.length).toBeGreaterThan(0);
    expect(rewrite.split("\n").filter(Boolean).length).toBeLessThan(encoded.chunks.slice(0, half).join("").split("\n").filter(Boolean).length);
  });
});

describe("AI SDK: partial JSON", () => {
  it.each(cases.filter((c) => c.id !== "text-churn" && c.id !== "counters"))("$id: the chunks are the final document's JSON", ({ id, frames }) => {
    const encoded = aiSdkJSON(frames, id);
    if (!("chunks" in encoded)) throw new Error("expressible");
    expect(encoded.chunks).toHaveLength(frames.length);
    expect(JSON.parse(encoded.chunks.join(""))).toEqual(frames.at(-1));
  });

  it("node by node: frame k's chunk ends where frame k's content does", () => {
    const { frames } = cases.find((c) => c.id === "nodes")!;
    const encoded = aiSdkJSON(frames, "nodes") as { chunks: string[] };
    let text = "";
    frames.forEach((frame, i) => {
      text += encoded.chunks[i]!;
      const closed = JSON.stringify(frame);
      expect(closed.startsWith(text) || text === closed).toBe(true);
    });
  });

  it("says why it cannot write edits", () => {
    for (const id of ["text-churn", "counters"] as const) {
      const encoded = aiSdkJSON(cases.find((c) => c.id === id)!.frames, id);
      expect(encoded).toEqual({ notExpressible: expect.stringMatching(/only appends/) });
    }
  });
});

describe("A2UI: v0.9 messages", () => {
  /** Our tree, from the surface's components: props as given, children by id. */
  const tree = (components: Map<string, { type: string; properties: Record<string, unknown> }>, id: string): Omit<Node, "key"> => {
    const c = components.get(id)!;
    const { children, ...props } = c.properties as { children?: string[] };
    return { type: c.type, props, ...(children ? { children: children.map((k) => tree(components, k)) } : {}) };
  };
  const withoutKeys = (n: Node): Omit<Node, "key"> => ({
    type: n.type,
    props: n.props,
    ...(n.children ? { children: n.children.map(withoutKeys) } : {}),
  });

  it.each(cases)("$id: its own message processor builds the final document", ({ frames }) => {
    const encoded = a2uiJSONL(frames);
    if (!("chunks" in encoded)) throw new Error("expressible");
    const processor = new MessageProcessor([new Catalog(A2UI_CATALOG, "v0.9", kitApis as never)]);
    const errors: unknown[] = [];
    for (const chunk of encoded.chunks) {
      for (const line of chunk.split(String.fromCharCode(10)).filter(Boolean)) errors.push(...processor.processMessagesWithErrors(JSON.parse(line)));
    }
    expect(errors).toEqual([]);
    const surface = processor.model.getSurface(A2UI_SURFACE)!;
    expect(tree(surface.componentsModel.getAll() as never, "root")).toEqual(withoutKeys(frames.at(-1)!.root));
  });

  it("sends only new and changed components after the first frame", () => {
    const churn = cases.find((c) => c.id === "text-churn")!;
    const encoded = a2uiJSONL(churn.frames) as { chunks: string[] };
    expect(encoded.chunks[0]).toMatch(/^{"version":"v0.9","createSurface"/);
    const count = (chunk: string) => (JSON.parse(chunk.trim()) as { updateComponents: { components: unknown[] } }).updateComponents.components.length;
    const half = churn.frames.length / 2;
    expect(count(encoded.chunks[half]!)).toBeLessThan(count(encoded.chunks[0]!.split(String.fromCharCode(10))[1]!));
  });
});

describe("equal deliveries", () => {
  it.each(cases)("$id: every encoder gives one chunk per logical frame", ({ id, frames }) => {
    const counts = [oursSSE(frames), jsonRenderJSONL(frames), openuiLang(frames, id), aiSdkJSON(frames, id), a2uiJSONL(frames)]
      .map((e) => (Array.isArray(e) ? e : "chunks" in e ? e.chunks : null))
      .filter((c): c is string[] => c !== null)
      .map((c) => c.length);
    expect(new Set(counts)).toEqual(new Set([frames.length]));
  });

  it("this SDK's meta and complete travel with the first and last patch", () => {
    const chunks = oursSSE(cases[0]!.frames);
    expect(chunks[0]).toMatch(/^data: {"type":"meta"[\s\S]*"type":"patch"/);
    expect(chunks.at(-1)).toMatch(/"type":"patch"[\s\S]*data: {"type":"complete"/);
  });
});
