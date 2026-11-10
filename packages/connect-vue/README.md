# relax-ui-connect-vue

Render `<gen-ui>` documents with Vue components, such as Element Plus, Vuetify
or your own. Vue is the only peer.

```ts
import { vueConnector } from "relax-ui-connect-vue";
import { ElCard } from "element-plus";
import { defineComponent, h } from "vue";

const GenCard = defineComponent({
  props: { title: String },
  setup: (props, { slots }) => () =>
    h(ElCard, { role: "region", "aria-label": props.title }, { header: () => props.title, default: slots.default }),
});

el.setAttribute("mode", "light");
el.connectors = [vueConnector({ name: "element-plus", app, implementations: { Card: GenCard } })];
```

- A component's props are the node's **validated** props. Its default slot is
  where the renderer draws the node's children.
- Pass your `app`: components then share its plugins, global components and
  provided values.
- Render functions, or templates compiled at build time, keep the page free of
  `unsafe-eval`.
- `lazyComponent(() => import("./GenTable.vue"))` loads a component on first
  use.

A working Element Plus sample, with an app under a strict policy, is in
[examples/vue-host](../../examples/vue-host).
