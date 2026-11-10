// @vitest-environment happy-dom
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
