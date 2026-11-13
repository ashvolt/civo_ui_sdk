/**
 * This SDK's element with the Bootstrap 5 class connector from the HTML
 * example (`examples/html-host`), in light mode: the page links Bootstrap's
 * stylesheet, as that example's light page does, so the page's styles reach
 * the generated markup. For the attack suites (T-441, every connector).
 */
import { defineGenUI } from "relax-ui-element";
import { bootstrap5 } from "../../examples/html-host/src/connectors/bootstrap5.ts";
import { elementAdapter } from "../src/adapters/element.ts";
import { installKitCss } from "../src/kit/index.ts";
import { installHarness } from "../src/probe/page.ts";

defineGenUI();
// Light mode: the kit's styles go in the page, as a light host's do.
installKitCss();
installHarness(elementAdapter("ours-bootstrap", { mode: "light", connectors: [bootstrap5()] }));
