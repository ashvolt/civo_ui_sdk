import { createValidator } from "relax-ui-contract";
import { createCatalog, DomRenderer, type Template } from "relax-ui-render";
import { baseTemplates } from "relax-ui-theme-base";
import { benchContract } from "../workloads/contract.ts";
import { canonical } from "./page.ts";

/**
 * The reference drawing of a complete document: the DOM renderer, the base
 * theme's templates loaded eagerly, full validation against the bench
 * contract. Every renderer's output is compared with this (plan D2).
 */
export function referenceMarkup(document: unknown): string {
  const host = window.document.createElement("div");
  const renderer = new DomRenderer(host, {
    catalog: createCatalog({ templates: baseTemplates as unknown as Record<string, Template> }),
    types: benchContract.names,
    validate: "full",
    validator: createValidator(benchContract),
    maxDepth: benchContract.limits.maxDepth,
  });
  renderer.render((document as { root: never }).root, { complete: true });
  const markup = canonical(host.firstElementChild);
  renderer.destroy();
  return markup;
}
