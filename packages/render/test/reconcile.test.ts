// @vitest-environment happy-dom
import { createValidator, standardContract, STANDARD_COMPONENT_NAMES } from "relax-ui-contract";
import { createCatalog, DomRenderer, type DomRendererOptions, type Template } from "relax-ui-render";
import { baseTemplates } from "relax-ui-theme-base";
import type { UINode } from "relax-ui-core";
import { describe, expect, it } from "vitest";
import { canonical, DASHBOARD, frames, STREAMS } from "./fixtures.js";

const TYPES = STANDARD_COMPONENT_NAMES;
const validator = createValidator(standardContract);

function renderer(tier: "full" | "server", extra: Partial<DomRendererOptions> = {}) {
  const container = document.createElement("div");
  const r = new DomRenderer(container, {
    catalog: createCatalog({ templates: baseTemplates }),
    types: TYPES,
    validate: tier,
    ...(tier === "full" ? { validator } : {}),
    ...extra,
  });
  return { container, r };
}

/** A from-scratch render of one document, for comparison. */
function fresh(root: UINode | undefined, tier: "full" | "server"): string {
  const { container, r } = renderer(tier);
  r.render(root);
  return canonical(container);
}

const rootOf = (doc: unknown) => (doc as { root?: UINode } | undefined)?.root;

describe("reconciler property (T-230)", () => {
  for (const [name, doc] of Object.entries(STREAMS)) {
    for (const tier of ["full", "server"] as const) {
      it(`${name}, ${tier}: after every frame, the DOM equals a fresh render of that frame`, () => {
        const { container, r } = renderer(tier);
        const seen = frames(doc, 2);
        expect(seen.length).toBeGreaterThan(50);
        for (const [i, frame] of seen.entries()) {
          r.render(rootOf(frame));
          expect(canonical(container), `frame ${i}`).toBe(fresh(rootOf(frame), tier));
        }
        // And the last frame is the whole document.
        expect(canonical(container)).toBe(fresh(rootOf(doc), tier));
      });
    }
  }

  it("matches when frames arrive out of their natural granularity (large jumps)", () => {
    const { container, r } = renderer("full");
    for (const step of [97, 13, 1]) {
      for (const frame of frames(DASHBOARD, step)) {
        r.render(rootOf(frame));
        expect(canonical(container)).toBe(fresh(rootOf(frame), "full"));
      }
    }
  });

  it("matches when children are reordered, inserted and removed by key", () => {
    const { container, r } = renderer("full");
    const metric = (key: string, value: string): UINode => ({ type: "Metric", key, props: { label: key, value } });
    const grid = (...kids: UINode[]): UINode => ({ type: "Grid", props: { columns: 3 }, children: kids });
    const docs = [
      grid(metric("a", "1"), metric("b", "2"), metric("c", "3")),
      grid(metric("c", "3"), metric("a", "1"), metric("b", "2")),
      grid(metric("c", "3"), metric("x", "9"), metric("b", "2")),
      grid(metric("b", "20")),
      grid(metric("b", "20"), metric("b", "dup")),
    ];
    for (const d of docs) {
      r.render(d);
      expect(canonical(container)).toBe(fresh(d, "full"));
    }
  });

  it("clears the container for an empty document", () => {
    const { container, r } = renderer("full");
    r.render(rootOf(DASHBOARD));
    r.render(undefined);
    expect(container.innerHTML).toBe("");
  });
});

describe("identity (T-231)", () => {
  it("an untouched subtree keeps the very same DOM nodes after a frame", () => {
    const { container, r } = renderer("full");
    const all = frames(DASHBOARD, 2);
    // The frame where the heading is complete and the grid has started.
    const index = all.findIndex((f) => JSON.stringify(f).includes('"type":"Metric"'));
    const before = all[index]!;
    r.render(rootOf(before));
    const heading = container.querySelector("h2")!;
    const headingText = heading.firstChild!;
    expect(heading.textContent).toBe("UK public cloud spend");

    for (const next of all.slice(index + 1)) {
      r.render(rootOf(next));
      expect(container.querySelector("h2")).toBe(heading);
      expect(heading.firstChild).toBe(headingText);
    }
  });

  it("a finished metric is not touched while its siblings stream", () => {
    const { container, r } = renderer("full");
    const all = frames(DASHBOARD, 2);
    const i = all.findIndex((f) => JSON.stringify(f).includes('"YoY growth"'));
    r.render(rootOf(all[i]));
    const first = container.querySelector(".gen-metric")!;
    const value = first.querySelector(".gen-metric__value")!;
    for (const next of all.slice(i + 1)) {
      r.render(rootOf(next));
      expect(container.querySelector(".gen-metric")).toBe(first);
      expect(first.querySelector(".gen-metric__value")).toBe(value);
    }
  });

  it("a container whose props did not change keeps its element as children arrive", () => {
    const { container, r } = renderer("full");
    const all = frames(DASHBOARD, 2);
    const i = all.findIndex((f) => JSON.stringify(f).includes('"children":[{'));
    r.render(rootOf(all[i]));
    const stack = container.firstElementChild!;
    expect(stack.className).toContain("gen-stack");
    for (const next of all.slice(i + 1)) {
      r.render(rootOf(next));
      expect(container.firstElementChild).toBe(stack);
    }
  });

  it("a streaming text prop updates its text node in place", () => {
    const { container, r } = renderer("server");
    const t = (text: string): UINode => ({ type: "Text", props: { text } });
    r.render(t("Hel"));
    const p = container.querySelector("p")!;
    const node = p.firstChild!;
    r.render(t("Hello"));
    expect(container.querySelector("p")).toBe(p);
    expect(p.firstChild).toBe(node);
    expect(node.textContent).toBe("Hello");
  });
});

describe("output safety", () => {
  it("model text is text, never markup", () => {
    const { container, r } = renderer("full");
    r.render({ type: "Text", props: { text: `<img src=x onerror="alert(1)"><script>alert(2)</script>` } });
    expect(container.querySelector("img, script")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("refuses a URL the guard rejects even when validation is off", () => {
    const { container, r } = renderer("server");
    r.render({ type: "Link", props: { label: "x", href: "javascript:alert(1)" } });
    expect(container.querySelector("a")!.hasAttribute("href")).toBe(false);
  });

  it("a template cannot set an event handler, a style or a dangerous tag", () => {
    const container = document.createElement("div");
    const evil = () => ({
      tag: "div",
      attrs: { onclick: "alert(1)", style: "x", srcdoc: "x", class: "ok", "data-x": "1" },
      children: [{ tag: "script", attrs: {}, children: ["alert(1)"] }, { tag: "iframe", attrs: { src: "https://x" }, children: [] }],
    });
    const r = new DomRenderer(container, {
      catalog: createCatalog<Template>({ templates: { Evil: evil as unknown as Template } }),
      types: ["Evil"],
      validate: "server",
    });
    r.render({ type: "Evil", props: {} });
    const el = container.firstElementChild!;
    expect(el.getAttribute("class")).toBe("ok");
    expect(el.getAttribute("data-x")).toBe("1");
    expect(el.hasAttribute("onclick")).toBe(false);
    expect(el.hasAttribute("style")).toBe(false);
    expect(el.hasAttribute("srcdoc")).toBe(false);
    expect(container.querySelector("script, iframe")).toBeNull();
  });

  it("draws SVG in the SVG namespace", () => {
    const { container, r } = renderer("full");
    r.render(rootOf(DASHBOARD));
    expect(container.querySelector("svg")!.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(container.querySelector("rect")!.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });
});
