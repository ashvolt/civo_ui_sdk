/**
 * The red-team's page (T-444): this SDK's element with the Next example's own
 * contract (`examples/next-app/app/ui-registry.ts`), as that app's page
 * renders the route's stream. Each run's stream, as the route sent it, is
 * read here and judged by the attack harness's evidence.
 */
import { defineGenUI, type GenUIElement } from "relax-ui-element";
import { dashboardContract } from "../../examples/next-app/app/ui-registry.ts";
import { attackElement } from "../src/adapters/element.ts";
import { installHarness } from "../src/probe/page.ts";
import { referenceMarkup } from "../src/probe/reference.ts";

defineGenUI();

installHarness({
  id: "redteam",
  reference: referenceMarkup,
  mount() {
    throw new Error("the red-team page is for attacks only");
  },
  async attack(host, setup) {
    const el = document.createElement("gen-ui") as GenUIElement;
    el.contract = dashboardContract as never;
    host.replaceChildren(el);
    return attackElement(el, (s) => void (el.source = s as never), setup);
  },
});
