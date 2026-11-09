# Quickstart — one document, any host, any theme

**Feature**: 003-pluggable-generative-ui
**Status**: target experience. None of this runs yet; it is the acceptance test
the implementation must pass. Package names are provisional.

---

## 1. Plain HTML, base theme

```html
<script type="module" src="/vendor/relax-ui-element.js"></script>

<gen-ui id="ui" source="/api/ui" variant="light"></gen-ui>
<button onclick="ui.submit({ topic: 'Quarterly revenue' })">Generate</button>
<button onclick="ui.variant = ui.variant === 'dark' ? 'light' : 'dark'">Theme</button>
```

Expect: the layout streams in; only the components the document uses are
fetched; switching the theme restyles without regenerating.

## 2. Same page, Bootstrap look

```html
<link rel="stylesheet" href="/vendor/bootstrap.min.css">
<gen-ui id="ui" source="/api/ui" mode="light"></gen-ui>
<script type="module">
  import { bootstrap5 } from "/vendor/relax-ui-connect-bootstrap.js";
  ui.connectors = [bootstrap5];
</script>
```

Cards, tables, badges and alerts render with Bootstrap classes; anything the
connector does not map falls back to the base theme, and `gen-ui:state` lists it
in `fallbacks`.

## 3. Angular with Angular Material

```ts
@Component({
  selector: "app-report",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<gen-ui #ui source="/api/ui" mode="light"
                     (gen-ui:complete)="done($event)"></gen-ui>`,
})
export class ReportComponent implements AfterViewInit {
  @ViewChild("ui") ui!: ElementRef<GenUiElement>;
  private injector = inject(EnvironmentInjector);

  ngAfterViewInit() {
    this.ui.nativeElement.connectors = [angularConnector({
      name: "angular-material",
      injector: this.injector,
      implementations: {
        Card: () => import("./gen/mat-card").then((m) => m.GenMatCard),
        Table: () => import("./gen/mat-table").then((m) => m.GenMatTable),
      },
    })];
  }
}
```

## 4. A document that did not come from the SDK

```ts
const socket = new WebSocket("wss://events.example.com/ui");
ui.source = { socket };              // validated in full in the browser

ui.source = { document: savedJson }; // validated in full in the browser

ui.validate = "server";              // refused: config_invalid — not a same-origin URL
```

## 5. React, unchanged — or with themes

```tsx
const { object } = useGenerativeObject({ api: "/api/ui" });        // as today
<GenerativeUI node={object?.root} connectors={[mui]} />             // new: same connectors
```

## 6. What gets loaded

| Page | Loaded |
|---|---|
| no `<gen-ui>` on it | nothing from this SDK beyond what the page imports itself; **no component code** |
| a document using Stack, Metric, Text | protocol, render core, element, base tokens, those three components |
| same, from a same-origin route with `validate="server"` | as above, **without** the validator |
| same, from a WebSocket | as above, **with** the validator |

## 7. Size report

Every CI run adds a table to its summary:

```
package / chunk            gzip     change
relax-ui-protocol          ~3 KB    —
relax-ui-render            ~4 KB    —
relax-ui-element           ~3 KB    —
theme-base: tokens         ~1 KB    —
theme-base: Metric         ~0.6 KB  —
…
```

Figures above are research estimates; phase 1 replaces them with measurements.
