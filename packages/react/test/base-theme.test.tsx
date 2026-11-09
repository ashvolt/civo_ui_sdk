import { standardContract, STANDARD_COMPONENT_NAMES } from "relax-ui-contract";
import { h, CHILDREN } from "relax-ui-theme-base";
import type { UINode } from "relax-ui-core";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { baseComponents, fromTemplates, GenerativeTheme } from "../src/base-theme.js";
import { GenerativeUI, type RenderFailure } from "../src/renderer.js";

/** T-225. The React renderer, driven by the contract, drawing the base theme. */

const html = (node: UINode | undefined, onInvalidNode?: (f: RenderFailure) => React.ReactNode) =>
  renderToStaticMarkup(
    <GenerativeUI registry={standardContract} components={baseComponents as never} node={node} onInvalidNode={onInvalidNode} />,
  );

const n = (type: string, props: Record<string, unknown>, children?: UINode[]): UINode => ({
  type,
  props,
  ...(children ? { children } : {}),
});

const EVERYTHING = n("Stack", {}, [
  n("Heading", { text: "Q3 spend", level: 1 }),
  n("Grid", { columns: 2 }, [
    n("Metric", { label: "Total", value: "£4.1bn", trend: "up", caption: "vs Q2" }),
    n("Card", { title: "Notes" }, [n("Text", { text: "Illustrative.", tone: "muted" })]),
  ]),
  n("List", { items: ["one", "two"], ordered: true }),
  n("Table", { columns: ["Region", "Spend"], rows: [["UK", "£1m"]] }),
  n("Callout", { tone: "warning", title: "Heads up", body: "Figures are estimates." }),
  n("Badge", { text: "beta", tone: "info" }),
  n("Link", { label: "Source", href: "https://example.com/r" }),
  n("Chart", { kind: "bar", title: "By quarter", labels: ["Q1", "Q2"], series: [{ name: "UK", values: [1, 2] }] }),
]);

describe("React renderer on the standard contract (T-225)", () => {
  it("renders all twelve", () => {
    const out = html(EVERYTHING);
    for (const cls of ["gen-stack", "gen-heading--1", "gen-grid--2", "gen-metric", "gen-card", "gen-text--muted", "gen-list", "gen-table", "gen-callout", "gen-badge", "gen-link", "gen-chart"]) {
      expect(out, cls).toContain(cls);
    }
    expect(out).toContain("<h1");
    expect(out).toContain("<ol");
    expect(out).toContain('<th scope="col">Region</th>');
    expect(out).toContain("<svg");
    expect(out).toContain('<rect class="gen-chart__bar gen-chart--s1"');
  });

  it("implements every contract component", () => {
    expect(Object.keys(baseComponents).sort()).toEqual([...STANDARD_COMPONENT_NAMES].sort());
  });

  it("applies the contract's defaults before rendering", () => {
    expect(html(n("Stack", {}, [n("Text", { text: "x" })]))).toContain("gen-stack--column gen-gap--md");
  });

  it("escapes model text", () => {
    const out = html(n("Text", { text: `<img src=x onerror="alert(1)">` }));
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img src=x onerror=");
  });

  it("refuses a Link the URL guard rejects, before the component is called", () => {
    const failures: RenderFailure[] = [];
    const out = html(n("Link", { label: "x", href: "javascript:alert(1)" }), (f) => {
      failures.push(f);
      return null;
    });
    expect(out).toBe("");
    expect(failures).toEqual([{ reason: "invalid_props", type: "Link", detail: "href" }]);
  });

  it("refuses a type outside the contract", () => {
    const failures: RenderFailure[] = [];
    expect(html(n("Iframe", { src: "https://x" }), (f) => (failures.push(f), null))).toBe("");
    expect(failures[0]?.reason).toBe("unknown_type");
  });

  it("drops props the contract does not declare", () => {
    expect(html(n("Text", { text: "x", onClick: "alert(1)", style: "color:red" }))).not.toMatch(/onclick|style/i);
  });
});

describe("fromTemplates: the template-to-React boundary", () => {
  const hostile = fromTemplates({
    Evil: () =>
      h(
        "a",
        { href: "javascript:alert(1)", onclick: "alert(2)", style: "x", srcdoc: "x", class: "ok", "aria-label": "fine" },
        CHILDREN,
      ),
  });
  const render = () =>
    renderToStaticMarkup(React.createElement(hostile.Evil!, { props: {} as never, node: n("Evil", {}) }, "child"));

  it("refuses event handlers, style and escape hatches whatever a template sets", () => {
    const out = render();
    expect(out).not.toMatch(/onclick|style|srcdoc/i);
    expect(out).toContain('class="ok"');
    expect(out).toContain('aria-label="fine"');
  });

  it("re-checks href through the URL guard", () => {
    expect(render()).not.toContain("javascript:");
  });

  it("places children at the slot", () => {
    expect(render()).toContain(">child</a>");
  });
});

describe("GenerativeTheme", () => {
  it("sets the root class and the variant and density attributes", () => {
    const out = renderToStaticMarkup(
      <GenerativeTheme variant="dark" density="compact" className="mine">
        x
      </GenerativeTheme>,
    );
    expect(out).toBe('<div class="gen-theme mine" data-gen-variant="dark" data-gen-density="compact">x</div>');
  });

  it("defaults to light and comfortable", () => {
    expect(renderToStaticMarkup(<GenerativeTheme />)).toContain('data-gen-variant="light" data-gen-density="comfortable"');
  });
});
