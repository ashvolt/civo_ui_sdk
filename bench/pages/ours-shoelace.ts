/**
 * This SDK's element with the Shoelace element connector from the HTML
 * example (`examples/html-host`): Card, Metric, Callout and Badge become
 * Shoelace's own elements, with attributes from props, in the default shadow
 * mode. For the attack suites (T-441, every connector).
 */
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/alert/alert.js";
import "@shoelace-style/shoelace/dist/components/badge/badge.js";
import { defineGenUI } from "relax-ui-element";
import { shoelace } from "../../examples/html-host/src/connectors/shoelace.ts";
import { elementAdapter } from "../src/adapters/element.ts";
import { installHarness } from "../src/probe/page.ts";

defineGenUI();
installHarness(elementAdapter("ours-shoelace", { connectors: [shoelace({ stylesheet: "/vendor/shoelace-connector.css" })] }));
