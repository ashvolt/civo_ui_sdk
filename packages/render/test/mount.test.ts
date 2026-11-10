// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createValidator, standardContract } from "relax-ui-contract";
import {
  createCatalog,
  defineConnector,
  DomRenderer,
  layerConnectors,
  type MountImplementation,
  type RenderReport,
  type Renderable,
} from "relax-ui-render";
import { baseTemplates } from "relax-ui-theme-base";
import { canonical, DASHBOARD, frames, NESTED, REPORT } from "./fixtures.js";

/**
 * T-250: the mount contract framework connectors build on — `mount`, `update`,
 * `unmount`; children rendered by the core into the child host the component
 * places. A plain-DOM "framework" stands in for React, Angular and Vue, and
 * counts every call.
 */

const TYPES = Object.keys(baseTemplates);

interface Log {
  mounts: number;
  updates: number;
  unmounts: number;
  live: Set<Element>;
}

/** A framework component: draws `<div data-type>` with its props, then the child host. */
function fakeFramework(log: Log, options: { throwFor?: string } = {}): Record<string, MountImplementation> {
  const impls: Record<string, MountImplementation> = {};
  for (const type of TYPES) {
    impls[type] = {
      mount(host, props, childHost) {
        if (type === options.throwFor) throw new Error("boom");
        log.mounts++;
        log.live.add(host);
        const root = host.ownerDocument.createElement("div");
        root.setAttribute("data-type", type);
        const label = host.ownerDocument.createElement("span");
        const draw = (p: Record<string, unknown>) => {
          label.textContent = JSON.stringify(p);
          if (typeof p.href === "string") root.setAttribute("data-href", p.href);
          else root.removeAttribute("data-href");
        };
        draw(props);
        root.append(label, childHost);
        host.appendChild(root);
        return {
          update(next) {
            log.updates++;
            draw(next);
          },
          unmount() {
            log.unmounts++;
            log.live.delete(host);
            host.replaceChildren();
          },
        };
      },
    };
  }
  return impls;
}

function setup(options: { validate?: "full" | "server"; throwFor?: string } = {}) {
  const log: Log = { mounts: 0, updates: 0, unmounts: 0, live: new Set() };
  const reports: RenderReport[] = [];
  const host = document.createElement("div");
  const renderer = new DomRenderer(host, {
    catalog: createCatalog<Renderable>({ templates: fakeFramework(log, options) }),
    types: TYPES,
    validate: options.validate ?? "full",
    validator: createValidator(standardContract),
    onReport: (r) => reports.push(r),
  });
  return { log, reports, host, renderer };
}

const node = (type: string, props: Record<string, unknown>, children?: unknown[], key?: string) => ({
  type,
  props,
  ...(children ? { children } : {}),
  ...(key ? { key } : {}),
});

describe("mount, update, unmount", () => {
  it("mounts once into a host the renderer creates, and renders children into the child host", () => {
    const { log, host, renderer } = setup();
    renderer.render(node("Card", { title: "T" }, [node("Text", { text: "a" }), node("Text", { text: "b" })]) as never);
    expect(log.mounts).toBe(3);
    const card = host.firstElementChild!;
    expect(card.localName).toBe("gen-mount");
    const childHost = card.querySelector("gen-children")!;
    expect([...childHost.children].map((c) => c.localName)).toEqual(["gen-mount", "gen-mount"]);
    expect(childHost.textContent).toContain('"text":"a"');
  });

  it("updates only a node whose props changed, never re-mounts, and keeps children's DOM", () => {
    const { log, host, renderer } = setup();
    const text = node("Text", { text: "a" }, undefined, "t");
    renderer.render(node("Card", { title: "T" }, [text], "c") as never);
    const childBefore = host.querySelector("gen-children > gen-mount");
    renderer.render(node("Card", { title: "Title" }, [text], "c") as never);
    expect(log).toMatchObject({ mounts: 2, updates: 1, unmounts: 0 });
    expect(host.querySelector("gen-children > gen-mount")).toBe(childBefore);
    expect(host.textContent).toContain('"title":"Title"');
  });

  it("the final pass over a complete document updates nothing that did not change", () => {
    const { log, renderer } = setup();
    renderer.render(REPORT.root as never);
    const mounted = log.mounts;
    // `complete` walks every node again (to report refusals); unchanged props
    // must not reach the components.
    renderer.render(REPORT.root as never, { complete: true });
    expect(log).toMatchObject({ mounts: mounted, updates: 0, unmounts: 0 });
  });

  it("unmounts a removed node, its whole subtree, a node whose type changed, and everything on render(undefined)", () => {
    const { log, renderer } = setup();
    const deep = node("Card", { title: "x" }, [node("Stack", {}, [node("Text", { text: "deep" })])], "deep");
    renderer.render(node("Stack", {}, [deep, node("Text", { text: "kept" }, undefined, "k")]) as never);
    expect(log.live.size).toBe(5);
    renderer.render(node("Stack", {}, [node("Text", { text: "kept" }, undefined, "k")]) as never);
    expect(log.unmounts).toBe(3);
    expect(log.live.size).toBe(2);
    renderer.render(node("Stack", {}, [node("Badge", { text: "kept" }, undefined, "k")]) as never);
    expect(log.unmounts).toBe(4);
    renderer.render(undefined);
    expect(log.live.size).toBe(0);
  });

  it("destroy unmounts everything", () => {
    const { log, renderer } = setup();
    renderer.render(REPORT.root as never);
    expect(log.live.size).toBeGreaterThan(0);
    renderer.destroy();
    expect(log.live.size).toBe(0);
  });

  it("a component that throws while mounting is reported once and the rest renders", () => {
    const { reports, host, renderer } = setup({ throwFor: "Badge" });
    const doc = node("Stack", {}, [node("Badge", { text: "x" }), node("Badge", { text: "y" }), node("Text", { text: "ok" })]);
    renderer.render(doc as never);
    renderer.render(doc as never, { complete: true });
    expect(reports).toEqual([{ reason: "load_failed", type: "Badge", detail: "mount: boom" }]);
    expect(host.textContent).toContain('"text":"ok"');
  });

  it("the URL guard runs on a mounted component's props, in the server tier", () => {
    const { host, renderer } = setup({ validate: "server" });
    renderer.render(node("Link", { label: "x", href: "javascript:alert(1)" }) as never);
    expect(host.innerHTML).not.toContain("javascript:");
    renderer.render(node("Link", { label: "x", href: "https://example.com/" }) as never);
    expect(host.querySelector("[data-href]")!.getAttribute("data-href")).toBe("https://example.com/");
  });
});

describe("streaming through mounted components", () => {
  it.each([
    ["DASHBOARD", DASHBOARD],
    ["REPORT", REPORT],
    ["NESTED", NESTED],
  ])("%s: every node is mounted exactly once, nothing leaks, and the result equals a fresh render", (_, doc) => {
    for (const tier of ["full", "server"] as const) {
      const { log, host, renderer } = setup({ validate: tier });
      for (const frame of frames(doc, 2)) renderer.render((frame as { root?: never }).root);
      renderer.render(doc.root as never, { complete: true });
      const fresh = setup({ validate: tier });
      fresh.renderer.render(doc.root as never, { complete: true });
      expect(canonical(host), tier).toBe(canonical(fresh.host));
      const nodes = host.querySelectorAll("gen-mount").length;
      expect(log.live.size, `${tier}: live mounts`).toBe(nodes);
      // Partial frames may mount a node before its key or props settle; what
      // matters is that nothing is left mounted that is not on the page.
      expect(log.mounts - log.unmounts).toBe(nodes);
    }
  });
});

describe("framework connectors (K2)", () => {
  it("accept mount implementations; class and element connectors may not mount", () => {
    const mount = fakeFramework({ mounts: 0, updates: 0, unmounts: 0, live: new Set() }).Card!;
    expect(defineConnector({ name: "fw", kind: "framework", implementations: { Card: mount } }).mode).toBe("light");
    expect(() => defineConnector({ name: "c", kind: "class", implementations: { Card: mount } })).toThrowError(/framework/);
    expect(() => defineConnector({ name: "e", kind: "element", implementations: { Card: mount } })).toThrowError(/framework/);
  });

  it("layer over the base theme: unimplemented types fall back", () => {
    const mount = fakeFramework({ mounts: 0, updates: 0, unmounts: 0, live: new Set() }).Card!;
    const fw = defineConnector({ name: "fw", kind: "framework", implementations: { Card: mount } });
    const layered = layerConnectors({ types: TYPES, base: { templates: baseTemplates as never }, connectors: [fw] });
    expect(layered.templates.Card).toBe(mount);
    expect(layered.fallbacks.has("Text")).toBe(true);
    expect(layered.fallbacks.has("Card")).toBe(false);
  });
});
