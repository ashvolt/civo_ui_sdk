# Browser rendering: any source, any host, any theme library

Feature 003. A document can come from anywhere. The browser decides how much
to trust it, one resolver decides what each node becomes, and a connector
decides what it looks like.

```mermaid
flowchart LR
  subgraph Sources
    R["Same-origin route<br/>(SSE)"]
    X["Another origin"]
    S["ReadableStream"]
    W["WebSocket"]
    D["Static document"]
  end

  subgraph Protocol["relax-ui-protocol"]
    T{"resolveValidation()<br/>same origin and asked?"}
    RS["readSource()"]
    A["UIStreamAccumulator<br/>JSON Patch, shared structure"]
  end

  subgraph Render["relax-ui-render"]
    RV["Resolver<br/>contract types · depth<br/>validate by tier<br/>load code on exact type"]
    C["Catalog<br/>base theme, then connectors<br/>lazy, once per page"]
    DOM["DomRenderer<br/>keyed reconciler<br/>tag + attribute allowlists<br/>URL guard again"]
  end

  V["Validator<br/>relax-ui-contract + Zod<br/>loaded lazily"]

  subgraph Element["&lt;gen-ui&gt;"]
    SH["shadow (default)<br/>isolated"]
    LI["light<br/>global stylesheets"]
  end

  subgraph Connectors
    K1["class: Bootstrap"]
    K2["element: Shoelace"]
    K3["framework: MUI · Element Plus ·<br/>Angular Material (mounted)"]
  end

  R --> T
  X --> T
  S --> T
  W --> T
  D --> T
  T -- "server tier or full tier" --> RS
  T -. "server asked for a foreign source:<br/>config_invalid" .-> E["Refused<br/>nothing fetched or drawn"]
  RS --> A
  A --> RV
  RV -- "full tier only" --> V
  RV --> C
  C --> K1
  C --> K2
  C --> K3
  RV --> DOM
  DOM --> SH
  DOM --> LI
```

What to read from it:

- **Trust is decided once, per source, before anything is fetched.** Only a
  same-origin URL may skip browser validation, and only on request.
  ([ADR-0011](../adr/0011-same-origin-trust-boundary.md))
- **One resolver for every renderer.** React uses it too, so no host or
  connector can disagree about what a document shows.
  ([ADR-0009](../adr/0009-own-reconciler-on-structural-sharing.md))
- **Output safety sits in the DOM renderer, after the connectors.** Whatever a
  theme or connector returns, text stays text and URLs are checked again.
  Framework components set their own attributes, so their URL props are guarded
  before mount. ([ADR-0012](../adr/0012-mount-contract-for-framework-components.md))
- **The mode is about styles, not trust.** `light` gives up isolation so global
  stylesheets apply; validation and output safety do not change.
  ([ADR-0010](../adr/0010-shadow-and-light-modes.md))
