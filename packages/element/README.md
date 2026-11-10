# relax-ui-element

`<gen-ui>`: the standard Web Component for the relaxAI Generative UI SDK. It
renders a generated document in any host (plain HTML, Angular, Vue, a
micro-frontend) without a framework package.

**No dependencies.** The render core, the base theme and the protocol are
compiled in. `relax-ui-contract` and Zod are optional peers. They load only when
a document is validated in the browser.

## Use

```html
<script type="module">
  import "relax-ui-element/define";
</script>

<!-- The SDK's own route, same origin: the browser may trust its validation. -->
<gen-ui id="ui" source="/api/ui" validate="server" variant="dark"></gen-ui>
```

```ts
const el = document.querySelector("gen-ui")!;
await el.submit({ topic: "UK public cloud spend" }); // POSTs, then streams

el.source = { document: json };        // static: starts at once
el.source = { stream: response.body }; // any ReadableStream in SSE framing
el.source = { socket: ws };            // a WebSocket, one event per message; never closed
el.stop();
```

Every source other than a same-origin URL is validated in full in the browser.
`validate="server"` with any other source is refused with `config_invalid`, and
nothing is fetched or rendered.

| Attribute | Values |
|---|---|
| `source` | a same-origin URL (or set `.source`) |
| `validate` | `full` (default) · `server`, same-origin URL only |
| `mode` | `shadow` (default, isolated) · `light`, for global stylesheets. Fixed once the element is on the page |
| `variant` | `light` · `dark` · `auto`. Restyles without re-rendering |
| `density` | `comfortable` · `compact` |
| `preload` | component types to load now, e.g. `"Stack Metric"` |

Properties: `source`, `connectors`, `contract`, `validator`, `fallback` and
`state` (read-only).

## Events

All events bubble and cross the shadow boundary, so any framework can listen
without an adapter.

| Event | `detail` |
|---|---|
| `gen-ui:state` | `{ status, strategy, provider, metadata, error, fallbacks, loadFailures, overrides, refused }` |
| `gen-ui:frame` | one protocol event, after it is applied |
| `gen-ui:complete` | `{ value, metadata }` |
| `gen-ui:error` | `{ code, message, details? }`, with the same codes as `RelaxUIError` |

## Theming

A page restyles an element with tokens, in ordinary CSS:

```css
gen-ui { --gen-color-primary: #6b2fb3; --gen-radius-m: 0; }
gen-ui[variant="dark"] { --gen-color-primary: #c7a4f2; }
gen-ui::part(surface) { padding: 16px; }
```

In shadow mode the base theme's sheet is built once per page and shared by
every instance. Nothing the page styles reaches inside, and nothing inside
reaches the page.

## Connectors

A connector attaches a theme library, layered after the base theme. A later
connector wins a type, and the override is reported. A type that no connector
implements falls back to the base theme, and the fallback is reported.

```ts
import { defineConnector } from "relax-ui-element";

el.connectors = [
  defineConnector({
    name: "bootstrap-5",
    kind: "class",                          // restyle the base markup with classes
    mode: "light",                          // its stylesheet is global…
    stylesheets: ["/vendor/bootstrap.css"], // …unless adopted into the shadow root
    variants: { dark: { "data-bs-theme": "dark" } },
    requires: () => getComputedStyle(document.documentElement).getPropertyValue("--bs-primary") !== "",
    implementations: {
      Callout: { classes: { root: "alert", tone: { warning: "alert-warning" }, title: "alert-heading" } },
    },
  }),
];
```

- **`class`** (Bootstrap, Bulma, Tailwind): a declarative mapping of the base
  theme's classes. `gen-card` maps to `root`, `gen-card__title` to `title`,
  `gen-tone--warning` to `tone.warning`, and a component's own modifier
  (`gen-heading--2`) to `variant["2"]`. Unmapped `gen-` classes are dropped.
- **`element`** (Shoelace, Material Web): the root becomes the library's
  element, attributes come from props, and base parts go into named slots.
- **`template`**: markup as data, for an application's own component.

A connector cannot write markup, and it cannot render a node outside the
contract or skip validation: its output passes the same tag, attribute and URL
checks as the base theme's. Working Bootstrap 5 and Shoelace connectors are in
[examples/html-host](../../examples/html-host).

### Framework component libraries

React, Vue and Angular components are mounted per node by
[`relax-ui-connect-react`](../connect-react),
[`relax-ui-connect-vue`](../connect-vue) and
[`relax-ui-connect-angular`](../connect-angular). Each component receives
validated props and places the renderer's children: React's `children`, Vue's
default slot, or Angular's `<ng-content>`. These libraries put their styles in
`document.head`, so framework connectors need `mode="light"`. Samples:
MUI (`connect-react/samples`),
[Element Plus](../../examples/vue-host) and
[Angular Material](../../examples/angular-host).

## Content Security Policy

The element works under `script-src 'self'`, with no `unsafe-eval` and no
`unsafe-inline`, and under `style-src 'self'`. Styles are constructed
stylesheets, and lazy loading is plain `import()`. The
[html-host](../../examples/html-host) tests run under that policy.
