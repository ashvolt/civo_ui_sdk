/**
 * A2UI's Angular renderer (T-432): v0.9 messages, one per line, read from the
 * stream into A2UI's renderer service; `<a2ui-v09-surface>` draws the surface
 * with a catalog of kit components (`../kit/kit.ts`). Compiled ahead of time
 * by the Angular CLI and zoneless, as a production app is. A2UI's host
 * elements around each component are read through by the comparison.
 *
 * The service keeps one processor, so each new document deletes the surface
 * and the page shows a new surface component for the next.
 */
import { Component, provideZonelessChangeDetection, signal, type ApplicationRef } from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import { A2uiRendererService, AngularCatalog, createComponentImplementation, provideA2Ui } from "@a2ui/angular";
import { SurfaceComponent } from "@a2ui/angular/v0_9";
import { themeAttributes } from "relax-ui-theme-base";
import { componentRoot } from "../../src/adapters/contender-root.ts";
import { kitApis } from "../../src/kit/a2ui.ts";
import { installKitCss } from "../../src/kit/css.ts";
import { installHarness, type Mounted } from "../../src/probe/page.ts";
import { referenceMarkup } from "../../src/probe/reference.ts";
import { A2UI_CATALOG, A2UI_SURFACE } from "../../src/runner/contenders.ts";
import { KitComponent } from "../kit/kit.ts";

const catalog = new AngularCatalog(
  A2UI_CATALOG,
  "v0.9",
  kitApis.map((api) => createComponentImplementation(api as never, KitComponent)),
);

@Component({
  selector: "bench-a2ui-root",
  imports: [SurfaceComponent],
  template: `@for (d of [document()]; track d) {<a2ui-v09-surface [surfaceId]="surfaceId" />}`,
})
class Root {
  protected readonly surfaceId = A2UI_SURFACE;
  readonly document = signal(0);
}

let app: ApplicationRef | undefined;

function feed(appRef: ApplicationRef, root: Root, service: A2uiRendererService, host: HTMLElement, destroy: () => void): Mounted {
  let text = "";
  let error: Error | undefined;
  return {
    push(chunk) {
      text += chunk;
      for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n")) {
        const line = text.slice(0, end);
        text = text.slice(end + 1);
        try {
          if (line) service.processMessages(JSON.parse(line));
        } catch (e) {
          error ??= e as Error;
        }
      }
    },
    end() {},
    async done() {
      if (error) throw error;
      await appRef.whenStable();
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    },
    root: () => componentRoot(host),
    unmount: destroy,
    async next() {
      service.processMessages({ version: "v0.9", deleteSurface: { surfaceId: A2UI_SURFACE } });
      root.document.update((d) => d + 1);
      await appRef.whenStable();
      return feed(appRef, root, service, host, destroy);
    },
  };
}

installKitCss();
installHarness({
  id: "a2ui-angular",
  reference: referenceMarkup,
  unwrap: (el) => el.localName.startsWith("a2ui-") || el.localName.startsWith("kit-ng-"),
  async mount(host) {
    const attrs = themeAttributes("light", "comfortable");
    const theme = document.createElement("div");
    theme.className = attrs.class ?? "";
    theme.dataset.genVariant = attrs["data-gen-variant"] ?? "";
    theme.dataset.genDensity = attrs["data-gen-density"] ?? "";
    const rootElement = document.createElement("bench-a2ui-root");
    theme.append(rootElement);
    host.replaceChildren(theme);
    app ??= await createApplication({
      providers: [provideZonelessChangeDetection(), provideA2Ui({ catalogs: [catalog] })],
    });
    const ref = app.bootstrap(Root, rootElement);
    const service = app.injector.get(A2uiRendererService);
    // The service outlives the component: a fresh mount (an attack case)
    // must not find the last surface still there.
    const destroy = () => {
      try {
        service.processMessages({ version: "v0.9", deleteSurface: { surfaceId: A2UI_SURFACE } } as never);
      } catch {
        // no surface was created
      }
      ref.destroy();
    };
    return feed(app, ref.instance, service, host, destroy);
  },
});
