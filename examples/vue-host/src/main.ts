/**
 * `<gen-ui>` in a Vue application: no framework-specific SDK package for the
 * element itself (FR-221), and Element Plus attached through
 * `relax-ui-connect-vue`.
 *
 *   #base           the base theme, isolated in a shadow root, reading the
 *                   SDK's route (validate="server")
 *   #element-plus   Element Plus in light mode, a static document validated
 *                   in full in the browser
 *
 * The element is used as any element is in Vue: attributes in the render
 * function, properties and listeners on a template ref.
 */
import { createApp, defineComponent, h, onMounted, ref, type App } from "vue";
import { defineGenUI, type GenUIElement, type RenderState } from "relax-ui-element";
import { DOCUMENT } from "../../shared/document.mjs";
import { elementPlus } from "./connectors/element-plus.js";

defineGenUI();

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

let app: App;

const Root = defineComponent({
  setup() {
    const variant = ref<"light" | "dark">("light");
    const states = ref<Record<string, string>>({});
    const base = ref<GenUIElement>();
    const ep = ref<GenUIElement>();

    onMounted(() => {
      for (const [id, el] of [["base", base.value!], ["element-plus", ep.value!]] as const) {
        el.addEventListener("gen-ui:state", (event) => {
          const state = (event as CustomEvent<RenderState>).detail;
          el.dataset.status = state.status;
          states.value = { ...states.value, [id]: summary(state) };
        });
      }
      ep.value!.connectors = [elementPlus(app)];
      ep.value!.source = { document: labelled("Element Plus") };
      void base.value!.submit({ label: "route" });
    });

    return () =>
      h("div", [
        h("header", [
          h("h1", "gen-ui in a Vue app"),
          h("label", [
            "Variant ",
            h(
              "select",
              {
                id: "variant",
                value: variant.value,
                onChange: (e: Event) => (variant.value = (e.target as HTMLSelectElement).value as "light" | "dark"),
              },
              [h("option", { value: "light" }, "light"), h("option", { value: "dark" }, "dark")],
            ),
          ]),
        ]),
        h("main", [
          h("section", [
            h("h2", "Base theme · the SDK's route, validate=\"server\""),
            h("p", "Isolated in a shadow root; the page's styles do not reach it."),
            h("gen-ui", { id: "base", ref: base, source: "/api/ui", validate: "server", variant: variant.value }),
            h("output", { for: "base" }, states.value.base ?? ""),
          ]),
          h("section", [
            h("h2", "Element Plus · static document, validated in the browser"),
            h("p", "Card, Metric, Callout, Badge, Link and Text are Element Plus components, rendered by Vue."),
            h("gen-ui", { id: "element-plus", ref: ep, mode: "light", variant: variant.value }),
            h("output", { for: "element-plus" }, states.value["element-plus"] ?? ""),
          ]),
        ]),
      ]);
  },
});

app = createApp(Root);
app.mount("#app");
