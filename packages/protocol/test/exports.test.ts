import * as core from "relax-ui-core";
import * as protocol from "relax-ui-protocol";
import * as react from "relax-ui-react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * T-210. The protocol moved out of core; nothing that imported it from core may
 * notice. "Same name" is not enough — a second copy of `UIStreamAccumulator`
 * would be a second implementation of "what the document looks like now", the
 * drift `events.ts` exists to prevent. So core's export must be the very same
 * value as protocol's.
 */
const MOVED_FROM_CORE = [
  "RelaxUIError",
  "isRelaxUIError",
  "decodeSSE",
  "isStreamTerminator",
  "applyPatch",
  "diffJson",
  "decodePointerSegment",
  "encodePointerSegment",
  "fromPointer",
  "toPointer",
  "encodeUIStreamEvent",
  "isUIStreamEvent",
  "UI_STREAM_PROTOCOL_VERSION",
  "UIStreamAccumulator",
] as const;

describe("protocol package (T-210)", () => {
  it.each(MOVED_FROM_CORE)("core re-exports %s as the same value", (name) => {
    expect(protocol[name]).toBeDefined();
    expect(core[name]).toBe(protocol[name]);
  });

  it("react re-exports readUIStream as the same value", () => {
    expect(react.readUIStream).toBe(protocol.readUIStream);
  });

  it("exports the browser sources and the trust check", () => {
    expect(typeof protocol.readSource).toBe("function");
    expect(typeof protocol.sourceKind).toBe("function");
    expect(typeof protocol.resolveValidation).toBe("function");
    expect(typeof protocol.isSameOriginUrl).toBe("function");
  });

  it("exports nothing from the server half", () => {
    // The browser subset only. A client, a strategy or a provider profile here
    // would mean the split leaked.
    for (const name of ["createClient", "streamObject", "generateObject", "toSSEStream", "relaxai", "ollama"]) {
      expect(name in protocol).toBe(false);
    }
  });

  it("declares no runtime dependencies (NFR-202, Constitution V)", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies ?? {}).toEqual({});
  });

  it("core still declares no runtime dependencies (NFR-203)", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../core/package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies ?? {}).toEqual({});
  });
});

describe("RelaxUIError across copies of the module", () => {
  // core's build bundles protocol, so an application can hold two copies of
  // the class. This stands in for the other copy: a distinct constructor whose
  // instances carry the registered brand.
  const brand = Symbol.for("relax-ui.error");
  class OtherCopy extends Error {
    readonly [brand] = true;
    readonly code = "aborted";
  }

  it("instanceof and isRelaxUIError accept an error made by another copy", () => {
    const foreign = new OtherCopy("x");
    expect(foreign instanceof protocol.RelaxUIError).toBe(true);
    expect(protocol.isRelaxUIError(foreign)).toBe(true);
  });

  it("still rejects ordinary errors and non-objects", () => {
    expect(new Error("x") instanceof protocol.RelaxUIError).toBe(false);
    expect(protocol.isRelaxUIError({ code: "aborted" })).toBe(false);
    expect(protocol.isRelaxUIError(null)).toBe(false);
    expect(protocol.isRelaxUIError("RelaxUIError")).toBe(false);
  });

  it("keeps ordinary instanceof for a subclass", () => {
    class Sub extends protocol.RelaxUIError {}
    expect(new protocol.RelaxUIError({ code: "aborted", message: "x" }) instanceof Sub).toBe(false);
    expect(new Sub({ code: "aborted", message: "x" }) instanceof Sub).toBe(true);
  });
});
