/**
 * This SDK's element inside a Vue application (T-435): the app's template
 * renders `<gen-ui>` and binds its contract, connectors and source, as a Vue
 * host does (`examples/vue-host`). Each document is a new source set through
 * the app's state; Vue hands it to the element on its next update.
 */
import { createApp, h, markRaw, nextTick, shallowRef } from "vue";
import { defineGenUI, type GenUIElement } from "relax-ui-element";
import { feedElement } from "../src/adapters/element.ts";
import { kitConnector } from "../src/kit/index.ts";
import { installHarness } from "../src/probe/page.ts";
import { referenceMarkup } from "../src/probe/reference.ts";
import { benchContract } from "../src/workloads/contract.ts";

defineGenUI();

installHarness({
  id: "ours-vue-host",
  reference: referenceMarkup,
  async mount(host) {
    const source = shallowRef<{ stream: ReadableStream<Uint8Array> }>();
    const contract = markRaw(benchContract);
    const connectors = markRaw([kitConnector()]);
    const app = createApp({
      setup: () => () => h("main", { class: "bench-vue-app" }, [h("gen-ui", { contract, connectors, source: source.value })]),
    });
    const root = document.createElement("div");
    host.replaceChildren(root);
    app.mount(root);
    await nextTick();
    const el = root.querySelector("gen-ui") as GenUIElement;
    const mounted = feedElement(el, (s) => void (source.value = markRaw(s)));
    return { ...mounted, unmount: () => app.unmount() };
  },
});
