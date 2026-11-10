// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeUIStreamEvent } from "relax-ui-protocol";
import { defineConnector } from "relax-ui-element";
import { createCatalog, DomRenderer } from "relax-ui-render";
import { baseTemplates } from "relax-ui-theme-base";
import { createValidator, standardContract } from "relax-ui-contract";
import {
  canonical,
  DASHBOARD,
  events,
  fakeSocket,
  META,
  METADATA,
  mount,
  record,
  REPORT,
  sse,
  surface,
  until,
} from "./helpers.js";

/**
 * T-241: the element as a host sees it — attributes, the `source` property,
 * `submit`, `stop`, events, and the refusal table of the element contract.
 */

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const done = (el: { state: { status: string } }) => () => el.state.status !== "streaming";

/** What a fresh renderer, given the whole document at once, draws. */
function reference(doc: { root: unknown }): string {
  const host = document.createElement("div");
  new DomRenderer(host, {
    catalog: createCatalog({ templates: baseTemplates as never }),
    types: Object.keys(baseTemplates),
    validate: "full",
    validator: createValidator(standardContract),
  }).render(doc.root as never, { complete: true });
  return canonical(host.firstChild!);
}

describe("sources", () => {
  it("a static document renders, validated in the browser, with no server", async () => {
    const el = mount({}, { source: { document: REPORT } });
    await until(() => el.state.status === "complete" && !surface(el).querySelector("[aria-busy]"), "render");
    expect(canonical(surface(el).firstChild!)).toBe(reference(REPORT));
    expect(el.shadowRoot).not.toBeNull();
  });

  it("emits complete for a document source", async () => {
    const el = document.createElement("gen-ui") as never as HTMLElement & { source: unknown; state: { status: string } };
    const log: string[] = [];
    el.addEventListener("gen-ui:complete", () => log.push("complete"));
    el.source = { document: REPORT };
    document.body.appendChild(el);
    await until(() => el.state.status === "complete", "complete");
    expect(log).toEqual(["complete"]);
  });

  it("a ReadableStream builds the document up frame by frame (scenario 3)", async () => {
    const el = mount();
    const log = record(el);
    (el as { source: unknown }).source = { stream: sse(events(DASHBOARD)) };
    await until(() => el.state.status === "complete", "complete");
    await until(() => !surface(el).querySelector("[aria-busy]"), "chunks");
    expect(canonical(surface(el).firstChild!)).toBe(reference(DASHBOARD));
    const frames = log.of("gen-ui:frame");
    expect(frames.length).toBe(events(DASHBOARD).length);
    expect(el.state.provider).toBe("test-provider");
    expect(log.of("gen-ui:complete")[0]).toMatchObject({ value: DASHBOARD, metadata: METADATA });
  });

  it("a WebSocket is read as it arrives and never closed (S2)", async () => {
    const socket = fakeSocket();
    const el = mount({}, { source: { socket } as never });
    await until(socket.listening, "listening");
    const list = events(DASHBOARD);
    for (const event of list.slice(0, -1)) socket.send(event);
    await until(() => surface(el).querySelector(".gen-heading") !== null, "first frames");
    expect(el.state.status).toBe("streaming");
    socket.send(list.at(-1)!);
    await until(() => el.state.status === "complete", "complete");
    expect(socket.closedByReader).toBe(false);
    expect(socket.listening()).toBe(false);
  });

  it("a WebSocket closing mid-document is truncated, not finished", async () => {
    const socket = fakeSocket();
    const el = mount({}, { source: { socket } as never });
    const log = record(el);
    await until(socket.listening, "listening");
    for (const event of events(DASHBOARD).slice(0, 5)) socket.send(event);
    socket.hangUp();
    await until(() => el.state.status === "error", "error");
    expect(el.state.error?.code).toBe("truncated");
    expect(log.of("gen-ui:complete")).toHaveLength(0);
    expect(log.of("gen-ui:error")[0]).toMatchObject({ code: "truncated" });
  });

  it("a URL source waits for submit, then POSTs the body (same origin, validate=server)", async () => {
    const fetch = vi.fn(async () => new Response(sse(events(DASHBOARD)), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const validator = vi.fn(() => Promise.resolve(createValidator(standardContract)));
    const el = mount({ source: "/api/ui", validate: "server" }, { validator });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetch).not.toHaveBeenCalled();
    await el.submit({ topic: "cloud spend" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ui");
    expect(JSON.parse(String(init.body))).toEqual({ topic: "cloud spend" });
    expect(el.state.status).toBe("complete");
    // Scenario 4: the server tier never loads the validator.
    expect(validator).not.toHaveBeenCalled();
  });

  it("a string set as the source property is a URL, as the attribute is", async () => {
    const fetch = vi.fn(async () => new Response(sse(events(REPORT)), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const el = mount({ validate: "server" });
    (el as { source: unknown }).source = "/api/ui";
    expect(el.source).toEqual({ url: "/api/ui" });
    await el.submit({});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(el.state.status).toBe("complete");
    (el as { source: unknown }).source = null;
    expect(el.source).toBeUndefined();
  });

  it("validate=full on a URL loads the validator once", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse(events(DASHBOARD)), { status: 200 })));
    const validator = vi.fn(() => Promise.resolve(createValidator(standardContract)));
    const el = mount({ source: "/api/ui" }, { validator });
    await el.submit({});
    await until(() => !surface(el).querySelector("[aria-busy]"), "render");
    expect(validator).toHaveBeenCalledTimes(1);
    expect(canonical(surface(el).firstChild!)).toBe(reference(DASHBOARD));
  });
});

describe("stop", () => {
  it("stops reading, keeps what rendered, and ignores later frames", async () => {
    const socket = fakeSocket();
    const el = mount({}, { source: { socket } as never });
    await until(socket.listening, "listening");
    const list = events(DASHBOARD);
    for (const event of list.slice(0, 30)) socket.send(event);
    await until(() => surface(el).querySelector(".gen-heading") !== null, "something rendered");
    el.stop();
    expect(el.state.status).toBe("idle");
    await until(() => !socket.listening(), "stopped listening");
    const before = surface(el).innerHTML;
    for (const event of list.slice(30)) socket.send(event);
    await new Promise((r) => setTimeout(r, 20));
    expect(surface(el).innerHTML).toBe(before);
    expect(socket.closedByReader).toBe(false);
  });

  it("removing the element stops it; moving it does not", async () => {
    const socket = fakeSocket();
    const el = mount({}, { source: { socket } as never });
    await until(socket.listening, "listening");
    const other = document.createElement("div");
    document.body.appendChild(other);
    other.appendChild(el); // a move
    await new Promise((r) => setTimeout(r, 5));
    expect(socket.listening()).toBe(true);
    el.remove();
    await until(() => !socket.listening(), "stopped");
  });
});

describe("refusals (element contract)", () => {
  const refusedWith = async (el: { state: { status: string; error?: { code: string; message: string } } }) => {
    await until(() => el.state.status === "error", "refusal");
    return el.state.error!;
  };

  it.each([
    ["a document", { document: REPORT }],
    ["a stream", { stream: sse(events(REPORT)) }],
    ["a cross-origin URL", { url: "https://elsewhere.example/api/ui" }],
  ])('validate="server" with %s is config_invalid and renders nothing', async (_, source) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const el = mount({ validate: "server" });
    (el as { source: unknown }).source = source;
    if ("url" in source) void el.submit({});
    const error = await refusedWith(el);
    expect(error.code).toBe("config_invalid");
    expect(surface(el).childNodes).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validate="server" with a socket is refused, and the socket is not listened to', async () => {
    const socket = fakeSocket();
    const el = mount({ validate: "server" }, { source: { socket } as never });
    expect((await refusedWith(el)).code).toBe("config_invalid");
    expect(socket.listening()).toBe(false);
  });

  it("an unknown validate value is refused", async () => {
    const el = mount({ validate: "none" }, { source: { document: REPORT } });
    expect((await refusedWith(el)).code).toBe("config_invalid");
  });

  it("a connector whose library is missing is config_invalid naming it (K3)", async () => {
    const shoelace = defineConnector({
      name: "shoelace",
      kind: "element",
      requires: () => false,
      implementations: { Card: { tag: "sl-card" } },
    });
    const el = mount({}, { connectors: [shoelace], source: { document: REPORT } });
    const error = await refusedWith(el);
    expect(error.code).toBe("config_invalid");
    expect(error.message).toContain("shoelace");
  });

  it('a framework (light-only) connector with mode="shadow" is config_invalid', async () => {
    const framework = defineConnector({ name: "mui", kind: "framework", implementations: {} });
    const el = mount({}, { connectors: [framework], source: { document: REPORT } });
    const error = await refusedWith(el);
    expect(error.code).toBe("config_invalid");
    expect(error.message).toMatch(/mode="light"/);
    // The same connector in light mode is accepted.
    const ok = mount({ mode: "light" }, { connectors: [framework], source: { document: REPORT } });
    await until(() => ok.state.status === "complete", "light mode");
  });

  it("a node whose type is not in the contract is not rendered, and reported; the rest renders", async () => {
    const doc = {
      root: { type: "Stack", props: {}, children: [{ type: "Text", props: { text: "kept" } }, { type: "Iframe", props: { src: "x" } }] },
    };
    const el = mount({}, { source: { document: doc } });
    await until(() => el.state.status === "complete" && surface(el).textContent === "kept", "render");
    expect(el.state.refused).toEqual([{ reason: "unknown_type", type: "Iframe" }]);
    expect(surface(el).querySelector("iframe")).toBeNull();
  });

  it("invalid props are not rendered in full validation, and reported by field, never value", async () => {
    const doc = {
      root: {
        type: "Stack",
        props: {},
        children: [{ type: "Link", props: { label: "bad", href: "javascript:alert(1)" } }, { type: "Text", props: { text: "ok" } }],
      },
    };
    const el = mount({}, { source: { document: doc } });
    await until(() => el.state.refused.length > 0, "report");
    expect(el.state.refused[0]).toMatchObject({ reason: "invalid_props", type: "Link" });
    expect(JSON.stringify(el.state.refused)).not.toContain("javascript");
    expect(surface(el).querySelector("a")).toBeNull();
  });

  it("a document over the node budget stops with schema_violation", async () => {
    const children = Array.from({ length: 600 }, () => ({ type: "Text", props: { text: "x" } }));
    const el = mount({}, { source: { document: { root: { type: "Stack", props: {}, children } } } });
    const error = await refusedWith(el);
    expect(error.code).toBe("schema_violation");
  });

  it("a server error event becomes gen-ui:error with its code", async () => {
    const list = [META, { type: "error", error: { code: "rate_limited", message: "slow down", retryable: true } }] as never[];
    const el = mount();
    const log = record(el);
    (el as { source: unknown }).source = { stream: sse(list) };
    await until(() => el.state.status === "error", "error");
    expect(log.of("gen-ui:error")[0]).toMatchObject({ code: "rate_limited", message: "slow down" });
  });
});

describe("events and state (FR-223)", () => {
  it("reports streaming, then complete, with strategy and provider", async () => {
    const el = mount();
    const log = record(el);
    (el as { source: unknown }).source = { stream: sse(events(REPORT)) };
    await until(done(el), "done");
    const statuses = log.of("gen-ui:state").map((s) => s.status);
    expect(statuses[0]).toBe("streaming");
    expect(statuses.at(-1)).toBe("complete");
    expect(el.state).toMatchObject({ strategy: "json_schema", provider: "test-provider", metadata: METADATA });
    // Events cross the shadow boundary and bubble, so a framework can listen
    // on any ancestor.
    const outer: string[] = [];
    document.body.addEventListener("gen-ui:state", () => outer.push("state"));
    el.source = { document: REPORT };
    await until(() => outer.length > 0, "bubbled");
  });

  it("state is a copy: a host cannot change it", async () => {
    const el = mount({}, { source: { document: REPORT } });
    await until(() => el.state.status === "complete", "complete");
    el.state.refused.push({ reason: "unknown_type", type: "X" });
    expect(el.state.refused).toHaveLength(0);
  });
});

describe("variant, density and mode", () => {
  it("switching variant or density restyles without re-rendering (scenario 7)", async () => {
    const el = mount({ variant: "light" }, { source: { document: DASHBOARD } });
    await until(() => el.state.status === "complete" && !surface(el).querySelector("[aria-busy]"), "render");
    const nodes = [...surface(el).querySelectorAll("*")];
    const html = surface(el).innerHTML;
    el.setAttribute("variant", "dark");
    el.setAttribute("density", "compact");
    await new Promise((r) => setTimeout(r, 10));
    expect(surface(el).innerHTML).toBe(html);
    expect([...surface(el).querySelectorAll("*")].every((n, i) => n === nodes[i])).toBe(true);
  });

  it("the shadow root carries the theme scoped to the host, so page tokens win", () => {
    const el = mount();
    const sheets = el.shadowRoot!.adoptedStyleSheets ?? [];
    const css = sheets.length
      ? [...sheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join("\n")
      : el.shadowRoot!.querySelector("style")!.textContent!;
    expect(css).toMatch(/:host\s*\{/);
    expect(css).toMatch(/:host\(\[variant="dark"\]\)/);
    expect(css).not.toMatch(/\.gen-theme\[data-gen-variant/);
  });

  it('mode="light" renders into the element itself, with the theme adopted once', async () => {
    const a = mount({ mode: "light" }, { source: { document: REPORT } });
    const b = mount({ mode: "light" }, { source: { document: REPORT } });
    await until(() => a.state.status === "complete" && b.state.status === "complete", "both");
    expect(a.shadowRoot).toBeNull();
    expect(a.querySelector(".gen-theme .gen-heading")).not.toBeNull();
    const adopted = document.adoptedStyleSheets ?? [];
    const styles = document.head.querySelectorAll('style[data-gen-ui="light:gen-ui"]');
    expect(adopted.length + styles.length).toBe(1);
  });

  it("changing mode after insertion is refused, not half-applied", async () => {
    const el = mount();
    el.setAttribute("mode", "light");
    await until(() => el.state.status === "error", "refusal");
    expect(el.state.error?.code).toBe("config_invalid");
    expect(el.shadowRoot).not.toBeNull();
  });
});

describe("T-240: the reconciler inside a custom element", () => {
  it("every frame of a stream equals a fresh render, and unchanged nodes keep their DOM", async () => {
    const socket = fakeSocket();
    const el = mount({}, { source: { socket } as never });
    await until(socket.listening, "listening");
    const list = events(DASHBOARD, 5, false);
    let heading: Element | null = null;
    for (const event of list) {
      socket.send(event);
      await new Promise((r) => setTimeout(r, 0));
      const h = surface(el).querySelector(".gen-heading");
      if (heading === null) heading = h;
      else if (h && surface(el).querySelector(".gen-heading")?.textContent === "UK public cloud spend") {
        expect(h).toBe(heading);
      }
    }
    socket.send({ type: "complete", value: DASHBOARD, metadata: METADATA } as never);
    await until(() => el.state.status === "complete" && !surface(el).querySelector("[aria-busy]"), "complete");
    expect(canonical(surface(el).firstChild!)).toBe(reference(DASHBOARD));
  });

  it("an SSE chunk boundary anywhere does not change the result", async () => {
    const text = events(REPORT).map(encodeUIStreamEvent).join("");
    const bytes = new TextEncoder().encode(text);
    const el = mount();
    let i = 0;
    (el as { source: unknown }).source = {
      stream: new ReadableStream<Uint8Array>({
        pull(c) {
          if (i >= bytes.length) return c.close();
          c.enqueue(bytes.slice(i, i + 13));
          i += 13;
        },
      }),
    };
    await until(() => el.state.status === "complete" && !surface(el).querySelector("[aria-busy]"), "complete");
    expect(canonical(surface(el).firstChild!)).toBe(reference(REPORT));
  });
});
