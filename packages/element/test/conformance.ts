import { afterEach, describe, expect, it, vi } from "vitest";
import { standardContract } from "relax-ui-contract";
import type { Connector, GenUIElement } from "relax-ui-element";
import { events, mount, sse, until } from "./helpers.js";

/**
 * T-243: the connector conformance suite. One suite, run against every
 * connector (plan, Verification): whatever library draws a document,
 *
 * - every component renders, and its root keeps the role the contract names;
 * - text stays text: markup in a prop is never markup in the page;
 * - an unknown type renders nothing;
 * - the URL guard holds, in both validation tiers;
 * - a type the connector does not implement falls back, and is reported.
 */

const n = (type: string, props: Record<string, unknown>, children?: unknown[]) => ({
  type,
  props,
  ...(children ? { children } : {}),
});

const leaf = (type: string) => n("Text", { text: `inside ${type}` });

/** One valid instance of each of the twelve. */
export const SAMPLES: Record<string, () => unknown> = {
  Stack: () => n("Stack", { gap: "sm" }, [leaf("Stack")]),
  Grid: () => n("Grid", { columns: 2 }, [leaf("Grid"), leaf("Grid")]),
  Card: () => n("Card", { title: "Card title", subtitle: "sub" }, [leaf("Card")]),
  Heading: () => n("Heading", { text: "A heading", level: 2 }),
  Text: () => n("Text", { text: "A paragraph", tone: "muted" }),
  Metric: () => n("Metric", { label: "Spend", value: "£4m", trend: "up", caption: "vs £3m" }),
  List: () => n("List", { items: ["one", "two"], ordered: true }),
  Table: () => n("Table", { columns: ["Region", "Spend"], rows: [["UK", "£1m"]], caption: "Spend" }),
  Callout: () => n("Callout", { tone: "warning", title: "Heads up", body: "Illustrative." }),
  Badge: () => n("Badge", { text: "beta", tone: "success" }),
  Link: () => n("Link", { label: "Report", href: "https://example.com/report" }),
  Chart: () => n("Chart", { kind: "bar", title: "Trend", labels: ["a", "b"], series: [{ name: "s", values: [1, 2] }] }),
};

const HOSTILE = '<img src=x onerror="alert(1)"><b>bold</b><script>alert(2)</script>';

/** Every text prop of every component carries markup. */
const hostileDocument = () => ({
  root: n("Stack", {}, [
    n("Heading", { text: HOSTILE, level: 2 }),
    n("Text", { text: HOSTILE }),
    n("Card", { title: HOSTILE, subtitle: HOSTILE }, [n("Badge", { text: HOSTILE, tone: "info" })]),
    n("Metric", { label: HOSTILE, value: HOSTILE, caption: HOSTILE }),
    n("List", { items: [HOSTILE] }),
    n("Table", { columns: [HOSTILE], rows: [[HOSTILE]], caption: HOSTILE }),
    n("Callout", { tone: "info", title: HOSTILE, body: HOSTILE }),
    n("Link", { label: HOSTILE, href: "https://example.com/" }),
    n("Chart", { kind: "line", title: HOSTILE, labels: [HOSTILE, "b"], series: [{ name: HOSTILE, values: [1, 2] }] }),
  ]),
});

const allTwelve = () => ({ root: n("Stack", {}, Object.values(SAMPLES).map((make) => make())) });

/**
 * The element a component drew. A mounted framework component sits inside the
 * renderer's `gen-mount` host, which has no box of its own.
 */
function componentRoot(el: Element | null): Element {
  let e = el;
  while (e && e.localName === "gen-mount") e = e.firstElementChild;
  return e!;
}

export interface ConformanceSetup {
  connectors: () => Connector[];
  mode: "shadow" | "light";
  /** The types the connectors implement; the rest must fall back. */
  implemented: readonly string[];
  /** The element each implemented type's root becomes, when it is not the base theme's. */
  tags?: Readonly<Record<string, string>>;
}

export function conformance(name: string, setup: ConformanceSetup): void {
  describe(`connector conformance: ${name} (${setup.mode})`, () => {
    afterEach(() => {
      document.body.replaceChildren();
      vi.unstubAllGlobals();
    });

    const view = (el: GenUIElement) => (el.shadowRoot ?? el).querySelector(".gen-theme") as HTMLElement;
    const settled = (el: GenUIElement) => () =>
      el.state.status !== "streaming" && el.state.status !== "idle" && !view(el).querySelector("[aria-busy]");
    const show = async (doc: unknown, attrs: Record<string, string> = {}) => {
      const el = mount({ mode: setup.mode, ...attrs }, { connectors: setup.connectors(), source: { document: doc } });
      await until(settled(el), `${name} to render`);
      expect(el.state.error).toBeUndefined();
      return el;
    };

    it.each(Object.keys(SAMPLES))("%s renders, and its root has the contract's role", async (type) => {
      const el = await show({ root: SAMPLES[type]!() });
      const root = componentRoot(view(el).firstElementChild);
      expect(root, `${type} rendered`).not.toBeNull();
      expect(root.getAttribute("role")).toBe(standardContract.role(type));
      if (setup.tags?.[type]) expect(root.localName).toBe(setup.tags[type]);
      expect(el.state.refused).toEqual([]);
      expect(el.state.loadFailures).toEqual([]);
    });

    it("all twelve render together, children inside their parents", async () => {
      const el = await show(allTwelve());
      const v = view(el);
      for (const type of Object.keys(SAMPLES)) {
        expect(v.querySelector(`[role="${standardContract.role(type)}"]`), type).not.toBeNull();
      }
      // The eleven siblings sit inside the Stack, not beside it.
      expect(v.children).toHaveLength(1);
      for (const type of ["Stack", "Grid", "Card"]) expect(view(el).textContent).toContain(`inside ${type}`);
    });

    it("text stays text: markup in any prop is never markup on the page", async () => {
      const el = await show(hostileDocument());
      const v = view(el);
      expect(v.querySelector("img, b, script")).toBeNull();
      expect(v.textContent).toContain('<img src=x onerror="alert(1)">');
      for (const node of v.querySelectorAll("*")) {
        for (const attr of node.attributes) expect(attr.name.startsWith("on"), `${node.localName}[${attr.name}]`).toBe(false);
      }
    });

    it("an unknown type renders nothing, and the rest renders", async () => {
      const el = await show({ root: n("Stack", {}, [n("Script", { src: "x" }), n("Text", { text: "kept" })]) });
      expect(view(el).textContent).toBe("kept");
      expect(el.state.refused).toEqual([{ reason: "unknown_type", type: "Script" }]);
    });

    it("the URL guard holds with full validation: a javascript: link is refused", async () => {
      const el = await show({ root: n("Stack", {}, [n("Link", { label: "x", href: "javascript:alert(1)" })]) });
      expect(view(el).querySelector("a")).toBeNull();
      expect(el.state.refused[0]).toMatchObject({ reason: "invalid_props", type: "Link" });
    });

    it("the URL guard holds with server validation: the renderer drops the href", async () => {
      const doc = { root: n("Stack", {}, [n("Link", { label: "x", href: "javascript:alert(1)" })]) };
      const connectors = setup.connectors();
      // The route answers; anything else (a connector's stylesheet) goes where
      // it went before.
      const other = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) =>
          url === "/api/ui" ? new Response(sse(events(doc)), { status: 200 }) : other(url, init),
        ),
      );
      const el = mount({ mode: setup.mode, source: "/api/ui", validate: "server" }, { connectors });
      await el.submit({});
      await until(settled(el), "server tier render");
      expect(view(el).innerHTML).not.toContain("javascript:");
    });

    it("a type the connector does not implement falls back to the base theme, and is reported", async () => {
      const el = await show(allTwelve());
      const expected = Object.keys(SAMPLES)
        .filter((t) => !setup.implemented.includes(t))
        .sort();
      expect([...el.state.fallbacks].sort()).toEqual(setup.connectors().length === 0 ? [] : expected);
    });
  });
}
