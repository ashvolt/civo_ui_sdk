// @vitest-environment happy-dom
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
