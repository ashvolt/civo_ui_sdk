/**
 * A2UI's Lit renderer (T-432), its reference renderer: v0.9 messages, one per
 * line, read from the stream into a `MessageProcessor`; `<a2ui-surface>` draws
 * the surface with a catalog of kit components, each an `A2uiLitElement`.
 * They render into light DOM, as A2UI's own basic catalog does, so the page's
 * stylesheet reaches them. Each component's element (`<kit-lit-card>`) is
 * A2UI's host, read through by the comparison.
 */
import { A2uiLitElement } from "@a2ui/lit/v0_9";
import { Catalog, MessageProcessor, type SurfaceModel } from "@a2ui/web_core/v0_9";
import { nothing } from "lit";
import { themeAttributes } from "relax-ui-theme-base";
import { componentRoot } from "../src/adapters/contender-root.ts";
import { kitApis, kitProps } from "../src/kit/a2ui.ts";
import { installKitCss } from "../src/kit/css.ts";
import { drawLit } from "../src/kit/lit.ts";
import { installHarness, type Mounted } from "../src/probe/page.ts";
import { referenceMarkup } from "../src/probe/reference.ts";
import { A2UI_CATALOG } from "../src/runner/contenders.ts";

const tagOf = (name: string) => `kit-lit-${name.toLowerCase()}`;

const entries = kitApis.map((api) => {
  class KitElement extends A2uiLitElement<never> {
    protected override readonly api = api as never;
    override createRenderRoot() {
      return this;
    }
    override render() {
      const props = (this.controller as { props?: Record<string, unknown> } | undefined)?.props;
      if (!props) return nothing;
      const children = (props.children as string[] | undefined)?.map((id) => this.renderNode(id));
      return drawLit(api.name, kitProps(props), children);
    }
  }
  customElements.define(tagOf(api.name), KitElement);
  return { ...api, tagName: tagOf(api.name), element: KitElement };
});
const catalog = new Catalog(A2UI_CATALOG, "v0.9", entries as never);

type SurfaceElement = HTMLElement & { surface?: SurfaceModel<never>; updateComplete: Promise<boolean> };

function feed(theme: HTMLElement, host: HTMLElement): Mounted {
  const processor = new MessageProcessor([catalog as never]);
  const element = document.createElement("a2ui-surface") as SurfaceElement;
  processor.onSurfaceCreated((s) => void (element.surface = s as never));
  // Each document is a new surface, as an app shows a new response.
  theme.replaceChildren(element);
  const decoder = new TextDecoder();
  let text = "";
  let error: Error | undefined;
  return {
    push(chunk) {
      text += decoder.decode(new TextEncoder().encode(chunk), { stream: true });
      for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n")) {
        const line = text.slice(0, end);
        text = text.slice(end + 1);
        try {
          if (line) processor.processMessages(JSON.parse(line));
        } catch (e) {
          error ??= e as Error;
        }
      }
    },
    end() {},
    async done() {
      if (error) throw error;
      await element.updateComplete;
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    },
    root: () => componentRoot(host),
    unmount: () => host.replaceChildren(),
    next: async () => feed(theme, host),
  };
}

installKitCss();
installHarness({
  id: "a2ui-lit",
  reference: referenceMarkup,
  unwrap: (el) => el.localName.startsWith("a2ui-") || el.localName.startsWith("kit-lit-"),
  async mount(host) {
    const attrs = themeAttributes("light", "comfortable");
    const theme = document.createElement("div");
    theme.className = attrs.class ?? "";
    theme.dataset.genVariant = attrs["data-gen-variant"] ?? "";
    theme.dataset.genDensity = attrs["data-gen-density"] ?? "";
    host.replaceChildren(theme);
    return feed(theme, host);
  },
});
