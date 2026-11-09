// @vitest-environment happy-dom
import { createValidator, standardContract, STANDARD_COMPONENT_NAMES } from "relax-ui-contract";
import { createCatalog, DomRenderer, type RenderReport } from "relax-ui-render";
import { baseTemplates, type VNode } from "relax-ui-theme-base";
import type { UINode } from "relax-ui-core";
import { describe, expect, it, vi } from "vitest";

/** T-235: the validator's code loads only when it will be used (FR-208). */

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const validator = createValidator(standardContract);

/** Templates that record every props object they are called with. */
function recordingTemplates() {
  const calls: { type: string; props: Record<string, unknown> }[] = [];
  const templates = Object.fromEntries(
    Object.entries(baseTemplates).map(([type, template]) => [
      type,
      (props: Record<string, unknown>) => {
        calls.push({ type, props });
        return (template as (p: unknown) => VNode)(props);
      },
    ]),
  );
  return { calls, templates };
}

const DOC: UINode = {
  type: "Stack",
  props: {},
  children: [
    { type: "Metric", props: { label: "Total", value: "£4bn" } },
    { type: "Link", props: { label: "x", href: "javascript:alert(1)" } },
    { type: "Metric", props: { label: "Bad", value: 42 } },
    { type: "Heading", props: { text: "x".repeat(500) } },
  ],
};

describe("validation tiers (T-235)", () => {
  it('server: the validator is never loaded, at any point', async () => {
    const load = vi.fn(async () => validator);
    const r = new DomRenderer(document.createElement("div"), {
      catalog: createCatalog({ templates: baseTemplates }),
      types: STANDARD_COMPONENT_NAMES,
      validate: "server",
      validator: load,
    });
    r.render(DOC);
    r.render(DOC, { complete: true });
    await tick();
    expect(load).not.toHaveBeenCalled();
  });

  it("full: the validator is loaded on the first render, once, before any node renders", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const load = vi.fn(async () => {
      await gate;
      return validator;
    });
    const { calls, templates } = recordingTemplates();
    const container = document.createElement("div");
    const r = new DomRenderer(container, {
      catalog: createCatalog({ templates }),
      types: STANDARD_COMPONENT_NAMES,
      validate: "full",
      validator: load,
    });
    r.render(DOC);
    r.render(DOC);
    expect(load).toHaveBeenCalledTimes(1);
    // Before the validator arrives, nothing reaches a template.
    expect(calls).toEqual([]);
    expect(container.querySelector(".gen-metric")).toBeNull();

    release();
    await tick();
    await tick();
    expect(container.querySelector(".gen-metric")).not.toBeNull();
  });

  it("full: a template never receives props that failed validation", () => {
    const { calls, templates } = recordingTemplates();
    const reports: RenderReport[] = [];
    const r = new DomRenderer(document.createElement("div"), {
      catalog: createCatalog({ templates }),
      types: STANDARD_COMPONENT_NAMES,
      validate: "full",
      validator,
      onReport: (report) => reports.push(report),
    });
    r.render(DOC, { complete: true });
    for (const { type, props } of calls) {
      expect(validator.props(type, props).ok, `${type} ${JSON.stringify(props)}`).toBe(true);
    }
    expect(calls.map((c) => c.type)).toEqual(["Stack", "Metric"]);
    // And what was refused is reported, once each, at completion.
    expect(reports).toEqual([
      { reason: "invalid_props", type: "Link", detail: "href" },
      { reason: "invalid_props", type: "Metric", detail: "value" },
      { reason: "invalid_props", type: "Heading", detail: "text" },
    ]);
  });

  it("full: templates receive the contract's parsed props, defaults applied", () => {
    const { calls, templates } = recordingTemplates();
    new DomRenderer(document.createElement("div"), {
      catalog: createCatalog({ templates }),
      types: STANDARD_COMPONENT_NAMES,
      validate: "full",
      validator,
    }).render({ type: "Stack", props: {}, children: [{ type: "Text", props: { text: "x" } }] });
    expect(calls[0]).toEqual({ type: "Stack", props: { gap: "md", direction: "column" } });
  });

  it("does not report a node that is merely incomplete mid-stream", () => {
    const reports: RenderReport[] = [];
    const r = new DomRenderer(document.createElement("div"), {
      catalog: createCatalog({ templates: baseTemplates }),
      types: STANDARD_COMPONENT_NAMES,
      validate: "full",
      validator,
      onReport: (report) => reports.push(report),
    });
    r.render({ type: "Metric", props: { label: "To" } });
    r.render({ type: "Metric", props: { label: "Total" } });
    expect(reports).toEqual([]);
    r.render({ type: "Metric", props: { label: "Total", value: "£1" } }, { complete: true });
    expect(reports).toEqual([]);
  });

  it("full without a validator is a configuration error", () => {
    expect(
      () =>
        new DomRenderer(document.createElement("div"), {
          catalog: createCatalog({ templates: baseTemplates }),
          types: STANDARD_COMPONENT_NAMES,
          validate: "full",
        }),
    ).toThrowError(expect.objectContaining({ code: "config_invalid" }));
  });

  it("depth beyond the limit is not rendered, and is reported", () => {
    const reports: RenderReport[] = [];
    const container = document.createElement("div");
    const r = new DomRenderer(container, {
      catalog: createCatalog({ templates: baseTemplates }),
      types: STANDARD_COMPONENT_NAMES,
      validate: "server",
      maxDepth: 2,
      onReport: (report) => reports.push(report),
    });
    r.render({ type: "Stack", props: {}, children: [{ type: "Stack", props: {}, children: [{ type: "Text", props: { text: "too deep" } }] }] });
    expect(container.textContent).not.toContain("too deep");
    expect(reports).toEqual([{ reason: "depth_exceeded", type: "Text" }]);
  });
});
