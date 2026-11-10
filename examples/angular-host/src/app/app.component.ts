import {
  afterNextRender,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EnvironmentInjector,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { defineGenUI, type GenUIElement, type RenderState } from "relax-ui-element";
import { DOCUMENT } from "../../../shared/document.mjs";
import { material } from "../connectors/material";

defineGenUI();

/**
 * `<gen-ui>` in an Angular application: no framework-specific SDK package for
 * the element itself (FR-221), and Angular Material attached through
 * `relax-ui-connect-angular`.
 *
 *   #base       the base theme, isolated in a shadow root, reading the SDK's
 *               route (validate="server")
 *   #material   Angular Material in light mode, a static document validated in
 *               full in the browser
 *
 * The element is an ordinary element to Angular: attributes in the template,
 * properties and listeners through a view child.
 */
@Component({
  selector: "app-root",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <header>
      <h1>gen-ui in an Angular app</h1>
      <label>
        Variant
        <select id="variant" (change)="variant.set($any($event.target).value)">
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
      </label>
    </header>
    <main>
      <section>
        <h2>Base theme · the SDK's route, validate="server"</h2>
        <p>Isolated in a shadow root; the app's styles and Material's do not reach it.</p>
        <gen-ui #base id="base" source="/api/ui" validate="server" [attr.variant]="variant()"></gen-ui>
        <output for="base">{{ states()["base"] }}</output>
      </section>
      <section>
        <h2>Angular Material · static document, validated in the browser</h2>
        <p>Card, Metric, Callout, Badge and Table are Angular Material components, compiled ahead of time.</p>
        <gen-ui #material id="material" mode="light"></gen-ui>
        <output for="material">{{ states()["material"] }}</output>
      </section>
    </main>
  `,
})
export class AppComponent {
  readonly variant = signal("light");
  readonly states = signal<Record<string, string>>({});
  private readonly injector = inject(EnvironmentInjector);
  private readonly base = viewChild.required<ElementRef<GenUIElement>>("base");
  private readonly material = viewChild.required<ElementRef<GenUIElement>>("material");

  constructor() {
    afterNextRender(() => {
      const base = this.base().nativeElement;
      const mat = this.material().nativeElement;
      for (const [id, el] of [["base", base], ["material", mat]] as const) {
        el.addEventListener("gen-ui:state", (event) => {
          const state = (event as CustomEvent<RenderState>).detail;
          el.dataset["status"] = state.status;
          this.states.update((s) => ({ ...s, [id]: summary(state) }));
        });
      }
      mat.connectors = [material(this.injector)];
      mat.source = { document: labelled("Angular Material") };
      void base.submit({ label: "route" });
    });
  }
}

function summary(state: RenderState): string {
  const parts: string[] = [state.status];
  if (state.provider) parts.push(`provider ${state.provider}`);
  if (state.fallbacks.length) parts.push(`base theme for ${state.fallbacks.join(", ")}`);
  if (state.error) parts.push(`${state.error.code}: ${state.error.message}`);
  return parts.join(" · ");
}

/** The document, with its card's region named for the element showing it. */
function labelled(label: string): typeof DOCUMENT {
  const copy = structuredClone(DOCUMENT);
  const card = copy.root.children.find((c: { type: string }) => c.type === "Card")!;
  (card.props as { title: string }).title += ` · ${label}`;
  return copy;
}
