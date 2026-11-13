/**
 * Four `<gen-ui>` elements on one page, each isolated in its own shadow root:
 *
 *   #base       the base theme, reading the SDK's route (validate="server")
 *   #bootstrap  Bootstrap 5, its stylesheet adopted into the shadow root
 *   #shoelace   Shoelace's own elements, from a ReadableStream
 *   #custom     the base theme with the page's own tokens
 *
 * No framework. Every script and stylesheet is served from this origin.
 */
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/alert/alert.js";
import "@shoelace-style/shoelace/dist/components/badge/badge.js";
import { defineGenUI, type GenUIElement } from "relax-ui-element";
import { bootstrap5 } from "./connectors/bootstrap5.js";
import { shoelace } from "./connectors/shoelace.js";
import { showState, variantSwitch } from "./shared.js";
import { DOCUMENT } from "../../shared/document.mjs";

defineGenUI();
const el = (id: string) => document.getElementById(id) as GenUIElement;

for (const id of ["base", "bootstrap", "shoelace", "custom"]) showState(el(id));
variantSwitch();

// The SDK's own route, same origin: the browser trusts the server's
// validation and never downloads the validator.
void el("base").submit({ topic: "UK public cloud spend", label: "route" });

// A static document: validated in full in the browser.
el("bootstrap").connectors = [bootstrap5({ stylesheet: "/vendor/bootstrap.min.css" })];
el("bootstrap").source = { document: labelled("Bootstrap") };

// Any ReadableStream in the SDK's SSE framing: validated in full.
el("shoelace").connectors = [shoelace({ stylesheet: "/vendor/shoelace-connector.css", darkStylesheet: "/vendor/shoelace-dark.css" })];
void fetch("/api/ui", { method: "POST", body: JSON.stringify({ label: "Shoelace" }) }).then((response) => {
  el("shoelace").source = { stream: response.body! };
});

el("custom").source = { document: labelled("re-branded") };

/**
 * The document, with its card's region named for the element showing it: one
 * page, four copies of a document, and each landmark still has its own name.
 */
function labelled(label: string): typeof DOCUMENT {
  const copy = structuredClone(DOCUMENT);
  const card = copy.root.children.find((c: { type: string }) => c.type === "Card")!;
  (card.props as { title: string }).title += ` · ${label}`;
  return copy;
}
