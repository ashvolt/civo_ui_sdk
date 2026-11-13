/**
 * This SDK's element inside an Angular application (T-435): the app's
 * template renders `<gen-ui>` and binds its contract, connectors and source,
 * as an Angular host does (`examples/angular-host`). Compiled ahead of time
 * by the Angular CLI and zoneless. Each document is a new source set through
 * a signal; Angular hands it to the element on its next change detection.
 */
import { Component, CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection, signal, type ApplicationRef } from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import { defineGenUI, type GenUIElement } from "relax-ui-element";
import { attackElement, feedElement } from "../../src/adapters/element.ts";
import { kitConnector } from "../../src/kit/index.ts";
import { installHarness } from "../../src/probe/page.ts";
import { referenceMarkup } from "../../src/probe/reference.ts";
import { benchContract } from "../../src/workloads/contract.ts";

defineGenUI();

type Source = object;

@Component({
  selector: "bench-ng-host",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<main class="bench-ng-app"><gen-ui [contract]="contract" [connectors]="connectors" [source]="source()"></gen-ui></main>`,
})
class Host {
  protected readonly contract = benchContract;
  protected readonly connectors = [kitConnector()];
  readonly source = signal<Source | undefined>(undefined);
}

let app: ApplicationRef | undefined;

async function mountApp(host: HTMLElement) {
  const rootElement = document.createElement("bench-ng-host");
  host.replaceChildren(rootElement);
  app ??= await createApplication({ providers: [provideZonelessChangeDetection()] });
  const ref = app.bootstrap(Host, rootElement);
  await app.whenStable();
  const el = rootElement.querySelector("gen-ui") as GenUIElement;
  return { el, setSource: (s: Source) => ref.instance.source.set(s), unmount: () => ref.destroy() };
}

installHarness({
  id: "ours-angular-host",
  reference: referenceMarkup,
  async mount(host) {
    const { el, setSource, unmount } = await mountApp(host);
    return { ...feedElement(el, setSource), unmount };
  },
  async attack(host, setup) {
    const { el, setSource, unmount } = await mountApp(host);
    return { ...attackElement(el, setSource, setup), unmount };
  },
});
