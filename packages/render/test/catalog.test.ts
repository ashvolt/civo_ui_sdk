// @vitest-environment happy-dom
import { createValidator, standardContract, STANDARD_COMPONENT_NAMES } from "relax-ui-contract";
import { createCatalog, DomRenderer, type RenderReport, type Template } from "relax-ui-render";
import { baseTemplates, type VNode } from "relax-ui-theme-base";
import type { UINode } from "relax-ui-core";
import { describe, expect, it, vi } from "vitest";

/** T-233: lazy loading. T-238: nothing loads until something renders. */

const validator = createValidator(standardContract);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Loaders that resolve to the base templates, with a spy per type. */
function spiedLoaders() {
  const spies = Object.fromEntries(
    STANDARD_COMPONENT_NAMES.map((name) => [name, vi.fn(async () => baseTemplates[name] as (p: never) => VNode)]),
  );
  return spies as Record<string, ReturnType<typeof vi.fn>>;
}

function setup(loaders: Record<string, () => Promise<(p: never) => VNode>>, options: { preload?: string[] } = {}) {
  const reports: RenderReport[] = [];
  const catalog = createCatalog<Template>({ loaders, ...options });
  const container = document.createElement("div");
  const r = new DomRenderer(container, {
    catalog,
    types: STANDARD_COMPONENT_NAMES,
    validate: "full",
    validator,
    onReport: (report) => reports.push(report),
  });
  return { catalog, container, r, reports };
}

const metric = (type = "Metric"): UINode => ({ type, props: { label: "Total", value: "£4bn" } });
const stack = (...children: UINode[]): UINode => ({ type: "Stack", props: {}, children });

describe("lazy loading (T-233)", () => {
  it("calls each loader once per type, however often the type appears", async () => {
    const loaders = spiedLoaders();
    const { r } = setup(loaders);
    for (let i = 0; i < 5; i++) r.render(stack(metric(), metric(), metric()));
    await tick();
    r.render(stack(metric(), metric()));
    expect(loaders.Metric).toHaveBeenCalledTimes(1);
    expect(loaders.Stack).toHaveBeenCalledTimes(1);
    expect(loaders.Chart).not.toHaveBeenCalled();
  });

  it("shares one loader call across renderers on a page", async () => {
    const loaders = spiedLoaders();
    const catalog = createCatalog<Template>({ loaders });
    for (let i = 0; i < 3; i++) {
      new DomRenderer(document.createElement("div"), {
        catalog,
        types: STANDARD_COMPONENT_NAMES,
        validate: "full",
        validator,
      }).render(metric());
    }
    await tick();
    expect(loaders.Metric).toHaveBeenCalledTimes(1);
  });

  it("starts loading on the exact type name, never a partial one", () => {
    const loaders = spiedLoaders();
    const { r } = setup(loaders);
    for (const partial of ["M", "Met", "Metri", "metric", "Metrics"]) r.render({ type: partial, props: {} });
    expect(loaders.Metric).not.toHaveBeenCalled();
    r.render({ type: "Metric", props: {} });
    expect(loaders.Metric).toHaveBeenCalledTimes(1);
  });

  it("starts loading before the node's props are complete (FR-241)", () => {
    const loaders = spiedLoaders();
    const { r, container } = setup(loaders);
    r.render({ type: "Metric", props: { label: "To" } });
    expect(loaders.Metric).toHaveBeenCalledTimes(1);
    // Nothing of the component's own markup yet: it has not loaded.
    expect(container.querySelector(".gen-metric")).toBeNull();
  });

  it("never loads a type outside the contract", () => {
    const loaders = { ...spiedLoaders(), Script: vi.fn(async () => baseTemplates.Text as (p: never) => VNode) };
    const { r, reports } = setup(loaders);
    r.render({ type: "Script", props: { text: "x" } });
    expect(loaders.Script).not.toHaveBeenCalled();
    // Mid-stream an unknown type may be a name still being written: reported
    // only once the document is complete.
    expect(reports).toEqual([]);
    r.render({ type: "Script", props: { text: "x" } }, { complete: true });
    expect(reports).toEqual([{ reason: "unknown_type", type: "Script" }]);
  });

  it("renders a busy placeholder with children until the component loads, then the component", async () => {
    const gate = deferred<(p: never) => VNode>();
    const loaders = { ...spiedLoaders(), Stack: vi.fn(() => gate.promise) };
    const { r, container } = setup(loaders);
    r.render(stack(metric()));
    await tick();
    const placeholder = container.firstElementChild!;
    expect(placeholder.getAttribute("aria-busy")).toBe("true");
    // Children do not wait for their parent's code.
    expect(placeholder.querySelector(".gen-metric")).not.toBeNull();
    const metricEl = placeholder.querySelector(".gen-metric");

    gate.resolve(baseTemplates.Stack as (p: never) => VNode);
    await tick();
    const stackEl = container.firstElementChild!;
    expect(stackEl.className).toContain("gen-stack");
    expect(stackEl.hasAttribute("aria-busy")).toBe(false);
    // The child moved; it was not rebuilt.
    expect(stackEl.querySelector(".gen-metric")).toBe(metricEl);
  });

  it("a failed load renders the fallback, is reported once, and is retried on the next document only", async () => {
    let fail = true;
    const loaders = {
      ...spiedLoaders(),
      Metric: vi.fn(async () => {
        if (fail) throw new Error("chunk 404");
        return baseTemplates.Metric as (p: never) => VNode;
      }),
    };
    const { r, container, reports } = setup(loaders);
    const doc = stack(metric(), { type: "Text", props: { text: "still here" } });
    r.render(doc);
    await tick();
    for (let i = 0; i < 4; i++) r.render(stack(metric(), metric(), { type: "Text", props: { text: "still here" } }));
    await tick();

    expect(loaders.Metric).toHaveBeenCalledTimes(1);
    expect(reports.filter((x) => x.reason === "load_failed")).toEqual([{ reason: "load_failed", type: "Metric" }]);
    // The rest of the document is unaffected (FR-244).
    expect(container.textContent).toContain("still here");
    expect(container.querySelector(".gen-metric")).toBeNull();

    fail = false;
    r.startDocument();
    r.render(doc);
    await tick();
    expect(loaders.Metric).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".gen-metric")).not.toBeNull();
  });

  it("uses the host's fallback for a failed load", async () => {
    const loaders = { ...spiedLoaders(), Metric: vi.fn(async () => Promise.reject(new Error("x"))) };
    const container = document.createElement("div");
    const r = new DomRenderer(container, {
      catalog: createCatalog<Template>({ loaders }),
      types: STANDARD_COMPONENT_NAMES,
      validate: "full",
      validator,
      fallback: (report) => {
        const el = document.createElement("p");
        el.textContent = `could not show ${report.type}`;
        return el;
      },
    });
    r.render(metric());
    await tick();
    await tick();
    expect(container.textContent).toBe("could not show Metric");
  });

  it("preload loads chosen components eagerly (FR-243)", async () => {
    const loaders = spiedLoaders();
    setup(loaders, { preload: ["Stack", "Metric"] });
    expect(loaders.Stack).toHaveBeenCalledTimes(1);
    expect(loaders.Metric).toHaveBeenCalledTimes(1);
    expect(loaders.Chart).not.toHaveBeenCalled();
  });
});

describe("nothing loads until something renders (T-238)", () => {
  it("creating a catalog and a renderer loads no component and no validator", () => {
    const loaders = spiedLoaders();
    const validatorLoader = vi.fn(async () => validator);
    const catalog = createCatalog<Template>({ loaders });
    const r = new DomRenderer(document.createElement("div"), {
      catalog,
      types: STANDARD_COMPONENT_NAMES,
      validate: "full",
      validator: validatorLoader,
    });
    r.render(undefined);
    for (const spy of Object.values(loaders)) expect(spy).not.toHaveBeenCalled();
    expect(validatorLoader).not.toHaveBeenCalled();
  });
});
