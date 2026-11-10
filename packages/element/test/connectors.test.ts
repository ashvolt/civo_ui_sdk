// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap5 } from "../../../examples/html-host/src/connectors/bootstrap5.js";
import { shoelace } from "../../../examples/html-host/src/connectors/shoelace.js";
import { conformance } from "./conformance.js";
import { mount, REPORT, until } from "./helpers.js";

/**
 * T-243 run against every connector this phase ships (T-245, T-246), and the
 * base theme on its own as the control.
 */

beforeAll(() => {
  // What loading Bootstrap's stylesheet does, as far as `requires` can see.
  document.documentElement.style.setProperty("--bs-primary", "#0d6efd");
  // Shoelace's elements, registered as the library would register them.
  for (const tag of ["sl-card", "sl-alert", "sl-badge"]) {
    if (!customElements.get(tag)) customElements.define(tag, class extends HTMLElement {});
  }
});

const BOOTSTRAP = ["Stack", "Grid", "Card", "Heading", "Text", "Metric", "List", "Table", "Callout", "Badge", "Link"];
const SHOELACE = ["Card", "Metric", "Callout", "Badge"];
const CSS_URL = "/vendor/bootstrap.min.css";

const stubStylesheet = () => {
  const fetch = vi.fn(async () => new Response(".card { border: 1px solid; }", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

conformance("base theme alone", { connectors: () => [], mode: "shadow", implemented: [] });
conformance("base theme alone", { connectors: () => [], mode: "light", implemented: [] });
conformance("bootstrap-5", { connectors: () => [bootstrap5()], mode: "light", implemented: BOOTSTRAP });
conformance("bootstrap-5 + adopted stylesheet", {
  connectors: () => {
    stubStylesheet();
    return [bootstrap5({ stylesheet: CSS_URL })];
  },
  mode: "shadow",
  implemented: BOOTSTRAP,
});
conformance("shoelace", {
  connectors: () => [shoelace()],
  mode: "shadow",
  implemented: SHOELACE,
  tags: { Card: "sl-card", Metric: "sl-card", Callout: "sl-alert", Badge: "sl-badge" },
});
conformance("bootstrap-5 then shoelace", {
  connectors: () => [bootstrap5(), shoelace()],
  mode: "light",
  implemented: BOOTSTRAP,
  tags: { Card: "sl-card", Callout: "sl-alert", Badge: "sl-badge" },
});

describe("bootstrap-5 markup (T-245)", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("uses Bootstrap's classes and none of the base theme's on the components it maps", async () => {
    const el = mount({ mode: "light" }, { connectors: [bootstrap5()], source: { document: REPORT } });
    await until(() => el.state.status === "complete" && el.querySelector(".card") !== null, "render");
    const view = el.querySelector(".gen-theme")!;
    expect(view.querySelector("section.card > p.card-header")?.textContent).toBe("Regions");
    expect(view.querySelector("table.table.table-sm")).not.toBeNull();
    expect(view.querySelector("ol.ps-4")).not.toBeNull();
    const genClasses = [...view.querySelectorAll("[class]")].flatMap((e) => [...e.classList]).filter((c) => c.startsWith("gen-"));
    expect(genClasses).toEqual([]);
  });

  it("maps a modifier through its axis: Callout tone, Heading level", async () => {
    const doc = {
      root: {
        type: "Stack",
        props: {},
        children: [
          { type: "Callout", props: { tone: "danger", title: "t", body: "b" } },
          { type: "Heading", props: { text: "h", level: 3 } },
        ],
      },
    };
    const el = mount({ mode: "light" }, { connectors: [bootstrap5()], source: { document: doc } });
    await until(() => el.querySelector(".alert") !== null && el.querySelector("h3") !== null, "render");
    expect(el.querySelector(".alert")!.className).toBe("alert mb-0 alert-danger");
    expect(el.querySelector("h3")!.className).toBe("mb-0 h5");
    expect(el.querySelector(".alert")!.getAttribute("role")).toBe("note");
  });

  it("in shadow mode, the stylesheet is fetched once and adopted by every instance", async () => {
    const fetch = stubStylesheet();
    // A URL no earlier test fetched: the cache is per page, and the page is
    // shared by this file's tests.
    const connectors = [bootstrap5({ stylesheet: `${CSS_URL}?once` })];
    const a = mount({}, { connectors, source: { document: REPORT } });
    const b = mount({}, { connectors, source: { document: REPORT } });
    await until(() => a.state.status === "complete" && b.state.status === "complete", "both");
    await until(() => (a.shadowRoot!.adoptedStyleSheets ?? []).length >= 2, "adopted");
    expect(fetch).toHaveBeenCalledTimes(1);
    const sheet = a.shadowRoot!.adoptedStyleSheets[0];
    expect(b.shadowRoot!.adoptedStyleSheets[0]).toBe(sheet);
  });

  it("without its stylesheet on the page, light mode is config_invalid naming Bootstrap", async () => {
    document.documentElement.style.removeProperty("--bs-primary");
    try {
      const el = mount({ mode: "light" }, { connectors: [bootstrap5()], source: { document: REPORT } });
      await until(() => el.state.status === "error", "refusal");
      expect(el.state.error).toMatchObject({ code: "config_invalid" });
      expect(el.state.error!.message).toContain("bootstrap-5");
    } finally {
      document.documentElement.style.setProperty("--bs-primary", "#0d6efd");
    }
  });

  it("a class variant is added beside gen-theme and removed on switch", async () => {
    const connector = shoelace({ darkStylesheet: "/vendor/shoelace-dark.css" });
    stubStylesheet();
    const el = mount({ variant: "dark" }, { connectors: [connector], source: { document: REPORT } });
    await until(() => el.state.status === "complete", "render");
    const view = el.shadowRoot!.querySelector(".gen-theme")!;
    expect([...view.classList]).toEqual(["gen-theme", "sl-theme-dark"]);
    el.setAttribute("variant", "light");
    expect([...view.classList]).toEqual(["gen-theme"]);
  });

  it("follows the element's variant with Bootstrap's own data-bs-theme, without re-rendering", async () => {
    const el = mount({ mode: "light", variant: "dark" }, { connectors: [bootstrap5()], source: { document: REPORT } });
    await until(() => el.state.status === "complete" && el.querySelector(".card") !== null, "render");
    const view = el.querySelector(".gen-theme")!;
    const card = view.querySelector(".card");
    expect(view.getAttribute("data-bs-theme")).toBe("dark");
    el.setAttribute("variant", "light");
    expect(view.getAttribute("data-bs-theme")).toBe("light");
    el.setAttribute("variant", "auto");
    expect(view.hasAttribute("data-bs-theme")).toBe(false);
    expect(view.querySelector(".card")).toBe(card);
  });

  it("in shadow mode without a stylesheet to adopt, it is config_invalid", async () => {
    const el = mount({}, { connectors: [bootstrap5()], source: { document: REPORT } });
    await until(() => el.state.status === "error", "refusal");
    expect(el.state.error!.message).toMatch(/mode="light"/);
  });
});

describe("shoelace markup (T-246)", () => {
  afterEach(() => document.body.replaceChildren());

  it("renders the library's elements, attributes from props, parts in named slots", async () => {
    const doc = {
      root: {
        type: "Stack",
        props: {},
        children: [
          { type: "Card", props: { title: "Regions" }, children: [{ type: "Text", props: { text: "body" } }] },
          { type: "Callout", props: { tone: "warning", title: "t", body: "b" } },
          { type: "Badge", props: { text: "beta", tone: "info" } },
        ],
      },
    };
    const el = mount({}, { connectors: [shoelace()], source: { document: doc } });
    await until(() => el.state.status === "complete" && el.shadowRoot!.querySelector("sl-badge") !== null, "render");
    const root = el.shadowRoot!;
    const card = root.querySelector("sl-card")!;
    expect(card.querySelector('[slot="header"]')?.textContent).toBe("Regions");
    expect(card.textContent).toContain("body");
    expect(card.getAttribute("role")).toBe("region");
    const alert = root.querySelector("sl-alert")!;
    expect(alert.getAttribute("variant")).toBe("warning");
    expect(alert.hasAttribute("open")).toBe(true);
    expect(root.querySelector("sl-badge")!.getAttribute("variant")).toBe("primary");
    expect(root.querySelector("sl-badge")!.hasAttribute("pill")).toBe(true);
    expect(el.state.fallbacks.sort()).toEqual(["Stack", "Text"]);
  });

  it("is refused, naming the library, when its elements are not registered", async () => {
    const { defineConnector } = await import("relax-ui-element");
    const unregistered = defineConnector({ ...shoelace(), requires: () => customElements.get("sl-nothing") !== undefined });
    const el = mount({}, { connectors: [unregistered], source: { document: REPORT } });
    await until(() => el.state.status === "error", "refusal");
    expect(el.state.error!.message).toContain("shoelace");
  });
});

describe("layering (K4)", () => {
  afterEach(() => document.body.replaceChildren());

  it("a type claimed by two connectors: the later wins, and the override is reported", async () => {
    const el = mount({ mode: "light" }, { connectors: [bootstrap5(), shoelace()], source: { document: REPORT } });
    await until(() => el.state.status === "complete", "render");
    expect(el.state.overrides.sort()).toEqual([
      "Badge: shoelace over bootstrap-5",
      "Callout: shoelace over bootstrap-5",
      "Card: shoelace over bootstrap-5",
      "Metric: shoelace over bootstrap-5",
    ]);
    expect(el.querySelector("sl-card")).not.toBeNull();
    expect(el.querySelector("table.table")).not.toBeNull();
  });
});
