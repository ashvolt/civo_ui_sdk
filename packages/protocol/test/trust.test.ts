import { isSameOriginUrl, resolveValidation, type Source } from "relax-ui-protocol";
import { describe, expect, it } from "vitest";

/**
 * T-215. Browser validation may be skipped only for an http(s) URL of the
 * page's own origin, and only on request (FR-207, research R4). Everything else
 * asking to skip it is a configuration error — never a silent upgrade to full
 * validation (data model S1), because a silent upgrade hides the mistake from
 * the person who made it.
 */
const PAGE = "https://bank.example";
const socket = { readyState: 1, addEventListener() {}, removeEventListener() {} };
const stream = new ReadableStream<Uint8Array>();

describe("resolveValidation (T-215)", () => {
  it.each<[string, Source]>([
    ["a document", { document: { root: { type: "Text", props: { text: "x" } } } }],
    ["a stream", { stream }],
    ["a socket", { socket }],
    ["a cross-origin URL", { url: "https://elsewhere.example/api/ui" }],
    ["a URL on another port", { url: "https://bank.example:8443/api/ui" }],
    ["a URL on another scheme", { url: "http://bank.example/api/ui" }],
    ["a protocol-relative URL to another host", { url: "//elsewhere.example/api/ui" }],
    ["a non-http URL", { url: "data:text/event-stream,hello" }],
  ])('refuses validate: "server" for %s', (_name, source) => {
    expect(() => resolveValidation(source, "server", PAGE)).toThrowError(
      expect.objectContaining({ code: "config_invalid" }),
    );
  });

  it.each(["/api/ui", "api/ui", "https://bank.example/api/ui", "https://BANK.example:443/api/ui?x=1"])(
    'accepts validate: "server" for same-origin %s',
    (url) => {
      expect(resolveValidation({ url }, "server", PAGE)).toBe("server");
    },
  );

  it("names the source in the refusal, so the mistake is findable", () => {
    expect(() => resolveValidation({ socket }, "server", PAGE)).toThrowError(/socket/);
    expect(() => resolveValidation({ url: "https://elsewhere.example/x" }, "server", PAGE)).toThrowError(
      /elsewhere\.example/,
    );
  });

  it("defaults to full validation for every source", () => {
    for (const source of [{ document: {} }, { stream }, { socket }, { url: "/api/ui" }] as Source[]) {
      expect(resolveValidation(source, undefined, PAGE)).toBe("full");
      expect(resolveValidation(source, "full", PAGE)).toBe("full");
    }
  });

  it("refuses an unknown tier", () => {
    expect(() => resolveValidation({ url: "/api/ui" }, "none" as never, PAGE)).toThrowError(
      expect.objectContaining({ code: "config_invalid" }),
    );
  });
});

describe("isSameOriginUrl", () => {
  it("treats relative URLs as same-origin", () => {
    expect(isSameOriginUrl("/api/ui", PAGE)).toBe(true);
    expect(isSameOriginUrl("./ui", PAGE)).toBe(true);
  });

  it("without a page origin, only a relative URL is same-origin", () => {
    // Server-side rendering or a test runner: there is no page to compare with.
    expect(isSameOriginUrl("/api/ui", undefined)).toBe(true);
    expect(isSameOriginUrl("https://bank.example/api/ui", undefined)).toBe(false);
    expect(isSameOriginUrl("//bank.example/api/ui", undefined)).toBe(false);
  });

  it("rejects malformed URLs rather than guessing", () => {
    expect(isSameOriginUrl("https://", PAGE)).toBe(false);
    expect(isSameOriginUrl("javascript:alert(1)", PAGE)).toBe(false);
  });
});
