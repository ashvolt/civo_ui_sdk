import { describe, expect, it } from "vitest";
import { baseTemplates } from "relax-ui-theme-base";
import {
  checkConnector,
  compileImplementation,
  createCatalog,
  defineConnector,
  layerConnectors,
  Resolver,
  type ConnectorOptions,
  type RenderReport,
  type Renderable,
  type Template,
  type VNode,
} from "relax-ui-render";

/** T-244: `defineConnector` for the class and element kinds, and layering. */

const base = baseTemplates as unknown as Record<string, Template>;
const run = (t: Renderable, props: Record<string, unknown>) => (t as Template)(props as never) as VNode;

describe("defineConnector refuses a malformed connector", () => {
  const ok: ConnectorOptions = { name: "lib", kind: "class", implementations: { Card: { classes: { root: "card" } } } };
  it.each([
    ["an unknown kind", { ...ok, kind: "magic" }],
    ["a name with spaces", { ...ok, name: "my lib" }],
    ["a lower-case type", { ...ok, implementations: { card: { classes: {} } } }],
    ["a class map of numbers", { ...ok, implementations: { Card: { classes: { root: 3 } } } }],
    ["an element without a custom tag", { ...ok, kind: "element", implementations: { Card: { tag: "div" } } }],
    ["an event-handler attribute", { ...ok, kind: "element", implementations: { Card: { tag: "x-card", props: { onclick: "1" } } } }],
    ["a style attribute", { ...ok, kind: "element", implementations: { Card: { tag: "x-card", props: { style: "x" } } } }],
    ["an href attribute (would bypass the URL guard's source)", { ...ok, kind: "element", implementations: { Link: { tag: "x-link", props: { href: { from: "href" } } } } }],
    ["a bad slot name", { ...ok, kind: "element", implementations: { Card: { tag: "x-card", slots: { title: "a b" } } } }],
    ["a framework connector in shadow mode (K2)", { name: "mui", kind: "framework", mode: "shadow", implementations: {} }],
    ["a template that is not a function", { ...ok, implementations: { Card: { template: "<b>" } } }],
    ["a variant attribute that is not data-", { ...ok, variants: { dark: { id: "dark" } } }],
    ["a variant attribute event handler", { ...ok, variants: { dark: { onclick: "x" } } }],
    ["a variant class with markup in it", { ...ok, variants: { dark: { class: "a\"><b" } } }],
  ])("%s", (_, options) => {
    expect(() => defineConnector(options as ConnectorOptions)).toThrowError(expect.objectContaining({ code: "config_invalid" }));
  });

  it("defaults: element kinds work isolated, the others need light mode", () => {
    expect(defineConnector({ ...ok, kind: "element", implementations: {} }).mode).toBe("shadow");
    expect(defineConnector(ok).mode).toBe("light");
    expect(defineConnector({ name: "mui", kind: "framework", implementations: {} }).mode).toBe("light");
  });

  it("the result is frozen", () => {
    const c = defineConnector(ok);
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.stylesheets)).toBe(true);
  });
});

describe("checkConnector (K3)", () => {
  it("names the missing library; a throwing check counts as missing", () => {
    const missing = defineConnector({ name: "acme-ui", kind: "class", requires: () => false, implementations: {} });
    expect(() => checkConnector(missing)).toThrowError(/acme-ui/);
    const throwing = defineConnector({
      name: "acme-ui",
      kind: "class",
      requires: () => {
        throw new Error("no");
      },
      implementations: {},
    });
    expect(() => checkConnector(throwing)).toThrowError(/acme-ui/);
    expect(() => checkConnector(defineConnector({ name: "ok", kind: "class", requires: () => true, implementations: {} }))).not.toThrow();
  });
});

describe("class implementations restyle the base markup", () => {
  const callout = compileImplementation(
    "Callout",
    { tag: "div", classes: { root: "alert", tone: { warning: "alert-warning" }, title: "alert-heading", body: "mb-0" } },
    base.Callout,
  );

  it("maps root, parts and modifier axes; drops unmapped gen- classes; keeps role", () => {
    const v = run(callout, { tone: "warning", title: "T", body: "B" });
    expect(v.tag).toBe("div");
    expect(v.attrs).toEqual({ class: "alert alert-warning", role: "note" });
    expect((v.children[0] as VNode).attrs.class).toBe("alert-heading");
    expect((v.children[1] as VNode).attrs.class).toBe("mb-0");
  });

  it("a modifier the mapping does not name is dropped, not passed through", () => {
    const v = run(callout, { tone: "danger", title: "T", body: "B" });
    expect(v.attrs.class).toBe("alert");
  });

  it("a component's own modifier maps through `variant`", () => {
    const heading = compileImplementation("Heading", { classes: { variant: { "2": "h4" } } }, base.Heading);
    const v = run(heading, { text: "x", level: 2 });
    expect(v.attrs.class).toBe("h4");
    expect(v.tag).toBe("h2");
  });

  it("a part's modifier maps through the part's name", () => {
    const metric = compileImplementation("Metric", { classes: { trend: { up: "text-success" } } }, base.Metric);
    const v = run(metric, { label: "l", value: "v", trend: "up" });
    const trend = JSON.stringify(v);
    expect(trend).toContain('"class":"text-success"');
    expect(trend).not.toContain("gen-");
  });

  it("text stays a string child; it never becomes markup", () => {
    const v = run(callout, { tone: "info", title: "<b>x</b>", body: "y" });
    expect((v.children[0] as VNode).children).toEqual(["<b>x</b>"]);
  });

  it("needs a base implementation to restyle", () => {
    expect(() => compileImplementation("Custom", { classes: {} }, undefined)).toThrowError(/base implementation/);
  });
});

describe("element implementations swap the root for a library element", () => {
  const card = compileImplementation("Card", { tag: "sl-card", slots: { title: "header" } }, base.Card);
  const badge = compileImplementation(
    "Badge",
    { tag: "sl-badge", props: { pill: true, hidden: false, size: "small", variant: { from: "tone", map: { info: "primary" } } } },
    base.Badge,
  );

  it("keeps the root's role and aria, drops its base classes, slots named parts", () => {
    const v = run(card, { title: "Regions" });
    expect(v.tag).toBe("sl-card");
    expect(v.attrs).toEqual({ role: "region", "aria-label": "Regions" });
    const title = v.children[0] as VNode;
    expect(title.attrs).toEqual({ class: "gen-card__title", slot: "header" });
  });

  it("sets attributes from props: constants, booleans, mapped values; unmapped values are omitted", () => {
    expect(run(badge, { text: "b", tone: "info" }).attrs).toMatchObject({ pill: "", size: "small", variant: "primary" });
    expect(run(badge, { text: "b", tone: "info" }).attrs).not.toHaveProperty("hidden");
    expect(run(badge, { text: "b", tone: "danger" }).attrs).not.toHaveProperty("variant");
    expect(run(badge, { text: "b" }).attrs).not.toHaveProperty("variant");
  });

  it("an object prop is never stringified into an attribute", () => {
    const t = compileImplementation("Badge", { tag: "x-badge", props: { data: { from: "text" } } }, base.Badge);
    expect(run(t, { text: { toString: () => "<b>" } }).attrs).not.toHaveProperty("data");
  });
});

describe("layerConnectors", () => {
  const bootstrap = defineConnector({
    name: "bootstrap",
    kind: "class",
    implementations: { Card: { classes: { root: "card" } }, Badge: { classes: { root: "badge" } } },
  });
  const shoelace = defineConnector({
    name: "shoelace",
    kind: "element",
    implementations: { Badge: () => Promise.resolve({ tag: "sl-badge" }) },
  });
  const types = ["Card", "Badge", "Text", "Custom"];

  it("later connectors win, and each override is reported (K4)", () => {
    const layered = layerConnectors({ types, base: { templates: base }, connectors: [bootstrap, shoelace] });
    expect(layered.overrides).toEqual([{ reason: "override", type: "Badge", detail: "shoelace over bootstrap" }]);
    expect(layered.providers).toEqual({ Card: "bootstrap", Badge: "shoelace" });
  });

  it("types no connector implements fall back to the base theme (K1); with no connectors, nothing is a fallback", () => {
    expect([...layerConnectors({ types, base: { templates: base }, connectors: [bootstrap] }).fallbacks]).toEqual(["Text"]);
    expect([...layerConnectors({ types, base: { templates: base }, connectors: [] }).fallbacks]).toEqual([]);
  });

  it("a type with no implementation anywhere is absent", () => {
    const layered = layerConnectors({ types, base: { templates: base }, connectors: [bootstrap] });
    expect(layered.templates.Custom).toBeUndefined();
    expect(layered.loaders.Custom).toBeUndefined();
  });

  it("a connector implementation is a loader: it waits for the base template, then compiles", async () => {
    let baseLoads = 0;
    const layered = layerConnectors({
      types,
      base: { loaders: { Badge: () => (baseLoads++, Promise.resolve(base.Badge!)) } },
      connectors: [shoelace],
    });
    expect(baseLoads).toBe(0);
    const t = await layered.loaders.Badge!();
    expect(baseLoads).toBe(1);
    expect(run(t, { text: "x" }).tag).toBe("sl-badge");
  });

  it("a lazily loaded implementation is checked like an eager one", async () => {
    const bad = defineConnector({
      name: "bad",
      kind: "element",
      implementations: { Badge: () => Promise.resolve({ tag: "x-badge", props: { onload: "1" } }) },
    });
    const layered = layerConnectors({ types, base: { templates: base }, connectors: [bad] });
    await expect(layered.loaders.Badge!()).rejects.toThrowError(/onload/);
  });

  it("the resolver reports a fallback once per type per document, when it renders", async () => {
    const layered = layerConnectors({ types: ["Text", "Card"], base: { templates: base }, connectors: [bootstrap] });
    const reports: RenderReport[] = [];
    const resolver = new Resolver({
      catalog: createCatalog({ templates: layered.templates, loaders: layered.loaders }),
      types: ["Text", "Card"],
      validate: "server",
      fallbacks: layered.fallbacks,
      onReport: (r) => reports.push(r),
    });
    const text = { type: "Text", props: { text: "x" } };
    resolver.resolve(text, 1);
    resolver.resolve(text, 1);
    expect(reports).toEqual([{ reason: "fallback", type: "Text" }]);
    resolver.startDocument();
    resolver.resolve(text, 1);
    expect(reports).toHaveLength(2);
  });
});
