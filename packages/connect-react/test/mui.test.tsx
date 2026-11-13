// @vitest-environment happy-dom
import type { MountImplementation } from "relax-ui-render";
import { beforeAll, describe, expect, it } from "vitest";
import { conformance } from "../../element/test/conformance.js";
import { mount, REPORT, until } from "../../element/test/helpers.js";
import { mui, MUI_TYPES } from "../samples/mui.js";

/**
 * T-251: the MUI sample, through `relax-ui-connect-react`, passes the same
 * conformance suite as every other connector (T-243). Framework connectors
 * render in `light` mode (K2).
 */

beforeAll(() => {
  // React's act() environment flag: the renderer drives React outside a test
  // renderer, synchronously, as it does in a page.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

conformance("mui (React)", { connectors: () => [mui()], mode: "light", implemented: MUI_TYPES });

describe("MUI renders its own components", () => {
  it("MuiCard with the renderer's children inside CardContent", async () => {
    const el = mount({ mode: "light" }, { connectors: [mui()], source: { document: REPORT } });
    await until(() => el.state.status === "complete" && el.querySelector(".MuiCard-root") !== null, "render");
    const card = el.querySelector('.MuiCard-root[role="region"]')!;
    expect(card.querySelector(".MuiCardHeader-title")!.textContent).toBe("Regions");
    expect(card.querySelector(".MuiCardContent-root gen-children .MuiTable-root")).not.toBeNull();
    el.remove();
  });
});

describe("props that become CSS (spec 004, T-446)", () => {
  // At the server validation tier the page has not checked props; MUI writes
  // these into a stylesheet, so an unchecked value would be CSS of its own.
  const css = () => [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
  const draw = (type: string, props: Record<string, unknown>) => {
    const host = document.createElement("div");
    document.body.append(host);
    const impl = mui().implementations[type] as MountImplementation;
    const m = impl.mount(host, props, document.createElement("gen-children"));
    return { host, done: () => (m.unmount(), host.remove()) };
  };

  it.each([
    ["Stack", { direction: "row;background:url(https://pwn.invalid/a)" }],
    ["Stack", { gap: "constructor" }],
    ["Grid", { columns: "1,1fr);background:url(https://pwn.invalid/b" }],
  ])("%s %j is not written as CSS", async (type, props) => {
    const { host, done } = draw(type, props);
    await until(() => host.querySelector('[role="group"]') !== null, "render");
    expect(css()).not.toContain("pwn.invalid");
    expect(css()).not.toMatch(/function Object|\[native code\]/);
    done();
  });

  it("a column Stack does not wrap, so a full-width chart stays in its card", async () => {
    const { host, done } = draw("Stack", { direction: "column" });
    await until(() => host.querySelector('[role="group"]') !== null, "render");
    const cls = [...host.querySelector('[role="group"]')!.classList].filter((c) => c.startsWith("css-"));
    const rules = css();
    expect(cls.some((c) => new RegExp(`\\.${c}\\{[^}]*flex-wrap:nowrap`).test(rules))).toBe(true);
    done();
  });
});
