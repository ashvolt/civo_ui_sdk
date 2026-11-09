# Contract — The `<gen-ui>` Element and the Connector API

**Scope**: browser-side public API added by feature 003
**Status**: proposed. Names are provisional (nothing is published in this
feature) and may change before implementation; the *shapes* are what the plan
commits to.

---

## The element

```html
<gen-ui
  source="/api/ui"              <!-- same-origin URL; or set .source in JS -->
  validate="full"               <!-- full (default) | server: same-origin URL only -->
  mode="shadow"                 <!-- shadow (default) | light -->
  variant="light"               <!-- light | dark -->
  density="comfortable"         <!-- comfortable | compact -->
  preload="Stack Metric">       <!-- optional eager components -->
</gen-ui>
```

```ts
const el = document.querySelector("gen-ui")!;

el.connectors = [bootstrap5];            // layered after the base theme
el.contract = contract.extend({ … });    // application additions

el.source = { document: json };          // static
el.source = { url: "/api/ui" };          // same-origin SSE
el.source = { stream: response.body };   // any ReadableStream
el.source = { socket: ws };              // WebSocket, one event per message

await el.submit({ topic: "…" });         // POST body, for url sources
el.stop();
```

### Events

| Event | `detail` |
|---|---|
| `gen-ui:state` | `RenderState` (status, strategy, provider, fallbacks, loadFailures) |
| `gen-ui:frame` | one protocol event, after it is applied |
| `gen-ui:complete` | `{ value, metadata }` |
| `gen-ui:error` | `{ code, message, details? }` — same codes as `RelaxUIError` |

### Refusals

| Configuration | Result |
|---|---|
| `validate="server"` with a cross-origin URL, a document, a stream or a socket | `config_invalid`; nothing rendered |
| connector whose `requires` check fails | `config_invalid` naming the library |
| framework connector with `mode="shadow"` | `config_invalid`: framework connectors need `light` |
| a node whose type is not in the contract | not rendered; host fallback; reported |

---

## Connectors

```ts
import { defineConnector } from "relax-ui-render";
```

### Class-based (Bootstrap, Bulma, Tailwind, Pico)

Declarative; no code.

```ts
export const bootstrap5 = defineConnector({
  name: "bootstrap-5",
  kind: "class",
  mode: "light",                                   // or "shadow" + stylesheets
  stylesheets: ["/vendor/bootstrap.min.css"],      // adopted once in shadow mode
  requires: () => CSS.supports("color", "var(--bs-primary)"),
  implementations: {
    Card:    { tag: "div", classes: { root: "card", title: "card-title", body: "card-body" } },
    Metric:  { tag: "div", classes: { root: "card text-center", label: "text-muted small",
                                      value: "display-6", caption: "small" } },
    Badge:   { tag: "span", classes: { root: "badge", tone: { info: "text-bg-info",
                                      success: "text-bg-success", warning: "text-bg-warning" } } },
    Table:   { tag: "table", classes: { root: "table table-sm" } },
    Callout: { tag: "div", classes: { root: "alert", tone: { info: "alert-info",
                                      success: "alert-success", warning: "alert-warning" } } },
  },
});
```

Unlisted types (Stack, Grid, Heading, …) fall back to the base theme.

### Web-Component libraries (Material Web, Shoelace / Web Awesome, Fluent)

```ts
export const shoelace = defineConnector({
  name: "shoelace",
  kind: "element",
  mode: "shadow",
  requires: () => customElements.get("sl-card") !== undefined,
  implementations: {
    Card:    { tag: "sl-card", slots: { title: "header" } },
    Callout: { tag: "sl-alert", props: { open: true, variant: { from: "tone",
               map: { info: "primary", success: "success", warning: "warning" } } } },
    Badge:   { tag: "sl-badge", props: { variant: { from: "tone" } } },
  },
});
```

### Framework libraries (Angular Material, MUI, Vuetify)

Each framework package exports one helper that turns that framework's components
into `mount` implementations.

```ts
// Angular
import { angularConnector } from "relax-ui-connect-angular";
el.connectors = [angularConnector({
  name: "angular-material",
  injector: inject(EnvironmentInjector),
  implementations: { Card: GenMatCard, Metric: GenMatMetric, Table: GenMatTable },
})];
```

```tsx
// React
import { reactConnector } from "relax-ui-connect-react";
el.connectors = [reactConnector({ name: "mui", implementations: { Card: MuiCard } })];
```

```ts
// Vue
import { vueConnector } from "relax-ui-connect-vue";
el.connectors = [vueConnector({ name: "vuetify", app, implementations: { Card: VCardGen } })];
```

A component used by a framework connector receives validated `props` as inputs
and renders its children into the element it marks as the child host (a
`[gen-children]` element, a `childHost` ref, a default slot). Lazy loading works
the same way: an implementation entry may be a loader returning the component.

---

## Theme tokens

```css
gen-ui {
  --gen-color-primary: #1a73c7;
  --gen-radius-m: 10px;
  --gen-font-family: "Inter", system-ui, sans-serif;
}
gen-ui[variant="dark"] { --gen-color-surface: #17171d; }
```

Full list in [data-model.md §6](../data-model.md).

---

## React

`relax-ui-react` keeps its API. `GenerativeUI` and `useGenerativeObject` accept
the same `contract`, `connectors` and `source` options, so a React host can use
the element or stay with the hook and get identical rendering and validation.

---

## Compatibility

| Existing API | After 003 |
|---|---|
| `relax-ui-core` exports | unchanged; protocol re-exported from `relax-ui-protocol` |
| `useGenerativeObject({ api })` | unchanged; `api` is a same-origin URL source |
| `createUIRegistry` | unchanged; a registry can be turned into a contract extension |
| Wire protocol | version 1, unchanged |
