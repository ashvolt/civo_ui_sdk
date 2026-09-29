import { describe, expect, it } from "vitest";
import { redact } from "../src/guard/redaction.js";
import { assertSovereignEndpoint } from "../src/guard/sovereignty.js";
import { sanitizeUrl } from "../src/guard/url.js";

describe("assertSovereignEndpoint", () => {
  it("accepts the relaxAI endpoint", () => {
    expect(assertSovereignEndpoint("https://api.relax.ai/v1").hostname).toBe("api.relax.ai");
  });

  it("refuses a host outside the allowlist", () => {
    expect(() => assertSovereignEndpoint("https://api.openai.com/v1")).toThrowError(
      /sovereignty allowlist/,
    );
  });

  it("refuses plaintext http even for an allowlisted host", () => {
    expect(() => assertSovereignEndpoint("http://api.relax.ai/v1")).toThrowError(
      /Refusing to send prompts over http/,
    );
  });

  it("permits a loopback gateway only when explicitly opted in", () => {
    expect(() =>
      assertSovereignEndpoint("http://localhost:8080/v1", { allowInsecureTransport: true }),
    ).not.toThrow();
    expect(() => assertSovereignEndpoint("http://localhost:8080/v1")).toThrowError();
  });

  it("does not let the insecure opt-in unlock a remote host", () => {
    expect(() =>
      assertSovereignEndpoint("http://evil.example.com/v1", { allowInsecureTransport: true }),
    ).toThrowError(/Refusing to send prompts over http/);
  });

  it("supports wildcard suffixes but not bare-suffix collisions", () => {
    const policy = { allowedHosts: ["*.relax.ai"] };
    expect(() => assertSovereignEndpoint("https://eu.relax.ai/v1", policy)).not.toThrow();
    // "relax.ai" itself is not "*.relax.ai", and neither is "notrelax.ai".
    expect(() => assertSovereignEndpoint("https://relax.ai/v1", policy)).toThrowError();
    expect(() => assertSovereignEndpoint("https://notrelax.ai/v1", policy)).toThrowError();
  });

  it("rejects a malformed base URL with a config error", () => {
    expect(() => assertSovereignEndpoint("not-a-url")).toThrowError(/not a valid absolute URL/);
  });
});

describe("sanitizeUrl", () => {
  it("passes ordinary links through", () => {
    expect(sanitizeUrl("https://civo.com/ai")).toBe("https://civo.com/ai");
    expect(sanitizeUrl("mailto:hi@example.com")).toBe("mailto:hi@example.com");
  });

  it("keeps relative paths as written", () => {
    expect(sanitizeUrl("/dashboard")).toBe("/dashboard");
    expect(sanitizeUrl("#section")).toBe("#section");
    expect(sanitizeUrl("./next")).toBe("./next");
  });

  it("rejects script-bearing schemes", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(sanitizeUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("rejects the control-character obfuscation of javascript:", () => {
    expect(sanitizeUrl("java\u0000script:alert(1)")).toBeNull();
    expect(sanitizeUrl("java\tscript:alert(1)")).toBeNull();
  });

  it("rejects data URLs by default and non-image data URLs always", () => {
    expect(sanitizeUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(sanitizeUrl("data:image/png;base64,AAAA", { allowDataImages: true })).toContain("data:image/png");
    expect(sanitizeUrl("data:text/html;base64,AAAA", { allowDataImages: true })).toBeNull();
  });

  it("enforces a host allowlist when one is configured", () => {
    const policy = { allowedHosts: ["civo.com", "*.civo.com"] };
    expect(sanitizeUrl("https://civo.com/x", policy)).toBe("https://civo.com/x");
    expect(sanitizeUrl("https://docs.civo.com/x", policy)).toBe("https://docs.civo.com/x");
    expect(sanitizeUrl("https://evil.example/x", policy)).toBeNull();
  });

  it("rejects non-strings and empties", () => {
    expect(sanitizeUrl(undefined)).toBeNull();
    expect(sanitizeUrl(42)).toBeNull();
    expect(sanitizeUrl("   ")).toBeNull();
  });
});

describe("redact", () => {
  it("removes emails, cards and national insurance numbers", () => {
    const report = redact("Contact a.b@example.com, card 4111 1111 1111 1111, NI AB 12 34 56 C.");
    expect(report.text).not.toContain("a.b@example.com");
    expect(report.text).not.toContain("4111");
    expect(report.text).not.toContain("AB 12 34 56 C");
    expect(report.redacted).toBe(true);
    expect(report.hits["email"]).toBe(1);
  });

  it("ignores letter pairs a real NINO can never start with", () => {
    // D, F, I, Q, U and V are not valid NINO prefix letters, so QQ123456C is not
    // one. Matching it anyway would mangle ordinary text containing initials.
    expect(redact("reference QQ123456C").redacted).toBe(false);
  });

  it("leaves ordinary prose untouched", () => {
    const text = "Summarise Q3 revenue for the northern region in three bullets.";
    const report = redact(text);
    expect(report.text).toBe(text);
    expect(report.redacted).toBe(false);
  });

  it("counts every occurrence", () => {
    const report = redact("a@b.com and c@d.com");
    expect(report.hits["email"]).toBe(2);
  });

  it("does not carry regex state between calls", () => {
    const rule = { id: "x", pattern: /foo/g };
    expect(redact("foo foo", [rule]).hits["x"]).toBe(2);
    expect(redact("foo foo", [rule]).hits["x"]).toBe(2);
  });
});
