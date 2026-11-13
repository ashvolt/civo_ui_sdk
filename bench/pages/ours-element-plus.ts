/**
 * This SDK's element inside a Vue application with the Element Plus connector
 * from the Vue example (`examples/vue-host`), in light mode, given the app so
 * components share its context. The page links Element Plus's stylesheet. For
 * the attack suites (T-441, every connector).
 */
import { createApp, h, markRaw, nextTick, shallowRef } from "vue";
import { defineGenUI, type GenUIElement } from "relax-ui-element";
import { elementPlus } from "../../examples/vue-host/src/connectors/element-plus.ts";
import { attackElement, feedElement } from "../src/adapters/element.ts";
import { installKitCss, kitConnector } from "../src/kit/index.ts";
import { installHarness } from "../src/probe/page.ts";
import { referenceMarkup } from "../src/probe/reference.ts";
import { benchContract } from "../src/workloads/contract.ts";

defineGenUI();
// Light mode: the kit's styles go in the page, as a light host's do.
installKitCss();

async function mountApp(host: HTMLElement) {
  const source = shallowRef<object>();
  const contract = markRaw(benchContract);
  const connectors = shallowRef<readonly object[]>([]);
  const app = createApp({
    setup: () => () =>
      h("main", { class: "bench-vue-app" }, [h("gen-ui", { mode: "light", contract, connectors: connectors.value, source: source.value })]),
  });
  connectors.value = markRaw([kitConnector(), elementPlus(app)]);
  const root = document.createElement("div");
  host.replaceChildren(root);
  app.mount(root);
  await nextTick();
  const el = root.querySelector("gen-ui") as GenUIElement;
  return { el, setSource: (s: object) => void (source.value = markRaw(s)), unmount: () => app.unmount() };
}

installHarness({
  id: "ours-element-plus",
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
