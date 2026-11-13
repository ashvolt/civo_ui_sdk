/**
 * This SDK's element inside an Angular application with the Angular Material
 * connector from the Angular example (`examples/angular-host`), in light mode,
 * given the app's injector. For the attack suites (T-441, every connector).
 *
 * The example is on Angular 22; the bench is on 21, whose CLI runs on the Node
 * the bench uses, so this page compiles the example's connector against
 * Material 21.
 */
import { Component, CUSTOM_ELEMENTS_SCHEMA, EnvironmentInjector, inject, provideZonelessChangeDetection, signal, type ApplicationRef } from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import { defineGenUI, type GenUIElement } from "relax-ui-element";
// A copy of the example's file, made by `build.mjs`, so that its imports resolve here.
import { material } from "./material.copy.ts";
import { attackElement, feedElement } from "../../src/adapters/element.ts";
import { installKitCss, kitConnector } from "../../src/kit/index.ts";
import { installHarness } from "../../src/probe/page.ts";
import { referenceMarkup } from "../../src/probe/reference.ts";
import { benchContract } from "../../src/workloads/contract.ts";

defineGenUI();
// Light mode: the kit's styles go in the page, as a light host's do.
installKitCss();

type Source = object;

@Component({
  selector: "bench-ng-material",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<main class="bench-ng-app"><gen-ui mode="light" [contract]="contract" [connectors]="connectors" [source]="source()"></gen-ui></main>`,
})
class Host {
  protected readonly contract = benchContract;
  protected readonly connectors = [kitConnector(), material(inject(EnvironmentInjector))];
  readonly source = signal<Source | undefined>(undefined);
}

let app: ApplicationRef | undefined;

async function mountApp(host: HTMLElement) {
  const rootElement = document.createElement("bench-ng-material");
  host.replaceChildren(rootElement);
  app ??= await createApplication({ providers: [provideZonelessChangeDetection()] });
  const ref = app.bootstrap(Host, rootElement);
  await app.whenStable();
  const el = rootElement.querySelector("gen-ui") as GenUIElement;
  return { el, setSource: (s: Source) => ref.instance.source.set(s), unmount: () => ref.destroy() };
}

installHarness({
  id: "ours-material",
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
