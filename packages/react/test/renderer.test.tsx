import { createUIRegistry, displayText, urlString, type UINode } from "@civo/relax-ui-core";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createGenerativeRenderer, GenerativeUI, type RenderFailure } from "../src/renderer.js";

const registry = createUIRegistry(
  {
    Stack: { props: z.object({ gap: z.enum(["sm", "lg"]).default("sm") }), children: "optional" },
    Text: { props: z.object({ value: displayText(200) }) },
    Link: { props: z.object({ label: displayText(80), href: urlString() }) },
  },
  { maxDepth: 3 },
);

const components = {
  Stack: ({ props, children }: { props: { gap: "sm" | "lg" }; children?: React.ReactNode }) => (
    <div data-gap={props.gap}>{children}</div>
  ),
  Text: ({ props }: { props: { value: string } }) => <p>{props.value}</p>,
  Link: ({ props }: { props: { label: string; href: string } }) => (
    <a href={props.href}>{props.label}</a>
  ),
} as never;

const failures: RenderFailure[] = [];
const render = (node: UINode | undefined) => {
  failures.length = 0;
  return renderToStaticMarkup(
    <GenerativeUI
      registry={registry}
      components={components}
      node={node}
      onInvalidNode={(failure) => {
        failures.push(failure);
        return <span data-invalid={failure.reason} />;
      }}
      placeholder={<span data-placeholder />}
    />,
  );
};

describe("GenerativeUI", () => {
  it("renders a registered tree", () => {
    const html = render({
      type: "Stack",
      props: { gap: "lg" },
      children: [{ type: "Text", props: { value: "hello" } }],
    });
    expect(html).toBe('<div data-gap="lg"><p>hello</p></div>');
  });

  it("renders the placeholder before the first frame", () => {
    expect(render(undefined)).toContain("data-placeholder");
  });

  it("refuses a component the application never registered", () => {
    const html = render({ type: "script", props: { children: "alert(1)" } } as UINode);
    expect(html).toBe('<span data-invalid="unknown_type"></span>');
    expect(failures[0]?.reason).toBe("unknown_type");
  });

  it("refuses props that fail the component's schema", () => {
    const html = render({ type: "Text", props: { value: 42 } } as unknown as UINode);
    expect(failures[0]).toMatchObject({ reason: "invalid_props", type: "Text", detail: "value" });
    expect(html).toContain("invalid_props");
  });

  it("escapes model-authored text rather than interpreting it", () => {
    const html = render({ type: "Text", props: { value: '<img src=x onerror="alert(1)">' } });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("refuses a javascript: href even if it reaches the renderer", () => {
    // The server schema would have rejected this; the renderer is the second lock.
    const html = render({ type: "Link", props: { label: "x", href: "javascript:alert(1)" } });
    expect(html).not.toContain("javascript:");
    expect(failures[0]?.reason).toBe("invalid_props");
  });

  it("stops at the registry's depth limit", () => {
    let node: UINode = { type: "Text", props: { value: "deep" } };
    for (let i = 0; i < 6; i++) node = { type: "Stack", props: {}, children: [node] };
    const html = render(node);
    expect(html).toContain("depth_exceeded");
    expect(html).not.toContain("deep");
  });

  it("renders nothing at all when no failure renderer is supplied", () => {
    const html = renderToStaticMarkup(
      <GenerativeUI
        registry={registry}
        components={components}
        node={{ type: "Nope", props: {} }}
      />,
    );
    expect(html).toBe("");
  });

  it("keys children by the model-supplied key when there is one", () => {
    // Identity keys are what stop a streaming list from remounting every frame.
    const html = render({
      type: "Stack",
      props: {},
      children: [
        { type: "Text", key: "a", props: { value: "one" } },
        { type: "Text", key: "b", props: { value: "two" } },
      ],
    });
    expect(html).toBe("<div data-gap=\"sm\"><p>one</p><p>two</p></div>");
  });

  it("applies schema defaults before handing props to the component", () => {
    const html = render({ type: "Stack", props: {}, children: [] });
    expect(html).toContain('data-gap="sm"');
  });
});

describe("createGenerativeRenderer", () => {
  it("binds a registry to its implementations", () => {
    const Bound = createGenerativeRenderer(registry, components, {
      placeholder: <span data-empty />,
    });
    expect(renderToStaticMarkup(<Bound node={undefined} />)).toContain("data-empty");
    expect(renderToStaticMarkup(<Bound node={{ type: "Text", props: { value: "x" } }} />)).toBe("<p>x</p>");
  });
});
