/**
 * Bootstrap 5 in light mode: the page loads Bootstrap's stylesheet itself, and
 * the element renders into the page's DOM where that global stylesheet reaches
 * it. The trade-off is isolation: the page's styles reach the document too.
 */
import { defineGenUI, type GenUIElement } from "relax-ui-element";
import { bootstrap5 } from "./connectors/bootstrap5.js";
import { showState, variantSwitch } from "./shared.js";

defineGenUI();
const el = document.getElementById("bootstrap-light") as GenUIElement;
showState(el);
variantSwitch();
el.connectors = [bootstrap5()];
void el.submit({ topic: "UK public cloud spend" });
