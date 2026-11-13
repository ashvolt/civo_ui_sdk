// @vitest-environment happy-dom
import type { MountImplementation } from "relax-ui-render";
import { describe, expect, it } from "vitest";
import { conformance } from "../../element/test/conformance.js";
import { mount, REPORT, until } from "../../element/test/helpers.js";
import { elementPlus, ELEMENT_PLUS_TYPES } from "../../../examples/vue-host/src/connectors/element-plus.js";

/**
 * T-253: the Element Plus sample, through `relax-ui-connect-vue`, passes the
 * same conformance suite as every other connector (T-243), in `light` mode.
 */
conformance("element-plus (Vue)", { connectors: () => [elementPlus()], mode: "light", implemented: ELEMENT_PLUS_TYPES });

describe("Element Plus renders its own components", () => {
  it("el-card with the renderer's children in its default slot", async () => {
    const el = mount({ mode: "light" }, { connectors: [elementPlus()], source: { document: REPORT } });
    await until(() => el.state.status === "complete" && el.querySelector(".el-card") !== null, "render");
    const card = el.querySelector('.el-card[role="region"]')!;
    expect(card.querySelector(".el-card__header")!.textContent).toContain("Regions");
    expect(card.querySelector(".el-card__body gen-children table.gen-table")).not.toBeNull();
    expect(el.querySelector("a.el-link[role=link]")!.getAttribute("href")).toBe("https://example.com/report");
    el.remove();
  });
});

describe("props a component does not declare (spec 004, T-446)", () => {
  // At the server validation tier the page has not removed props the contract
  // does not have; Vue would put them on the root element as attributes.
  it("never reach the DOM as attributes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const props = JSON.parse('{"title":"t","__proto__":{"polluted":"pwn"}}') as Record<string, unknown>;
    Object.assign(props, { class: "evil", id: "login", slot: "header", part: "p", style: "position:fixed", onClick: "x" });
    const impl = elementPlus().implementations.Card as MountImplementation;
    const m = impl.mount(host, props, document.createElement("gen-children"));
    await until(() => host.querySelector(".el-card") !== null, "render");
    const card = host.querySelector(".el-card")!;
    for (const name of ["id", "slot", "part", "style", "polluted", "__proto__", "onclick"]) expect(card.hasAttribute(name), name).toBe(false);
    expect(card.classList.contains("evil")).toBe(false);
    expect(card.textContent).toContain("t");
    m.unmount();
    host.remove();
  });
});
