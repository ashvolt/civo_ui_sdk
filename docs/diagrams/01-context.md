# Context

```mermaid
graph LR
    User([End user])

    subgraph app["Customer Next.js application"]
        direction TB
        Registry["ui-registry.ts<br/><b>one declaration</b>"]
        Page["page.tsx<br/>useGenerativeObject<br/>GenerativeUI"]
        Route["api/ui/route.ts<br/>createGenerativeUIRoute"]
        Key[["RELAX_API_KEY<br/>server only"]]
    end

    subgraph sdk["SDK"]
        Core["relax-ui-core"]
        RPkg["relax-ui-react"]
        NPkg["relax-ui-next"]
    end

    Relax[("relaxAI<br/>api.relax.ai/v1<br/>UK jurisdiction")]

    User -->|"topic"| Page
    Page -->|"POST /api/ui<br/>same origin"| Route
    Route -->|"SSE: meta · patch · complete"| Page
    Route --> NPkg --> Core
    Page --> RPkg --> Core
    Core -->|"POST /chat/completions<br/>Bearer"| Relax
    Key --- Route
    Registry -.->|"JSON Schema + validator"| Route
    Registry -.->|"renderer lookup"| Page

    classDef sec fill:#f2fbf4,stroke:#2f855a
    classDef ext fill:#eef6ff,stroke:#2b6cb0
    class Key sec
    class Relax,User ext
```

## What the diagram is drawn to make obvious

**The credential has exactly one home.** It is read by the route handler at cold
start and never enters a client bundle. The browser talks only to its own origin;
it has no relaxAI endpoint, no model name it could change, and no key.

**The registry is declared once and read twice.** The dotted lines are the same
file. On the server it becomes the JSON Schema relaxAI is sent and the validator
that gates every frame; on the client it becomes the renderer's lookup table.
Nothing has to be kept in sync because there is only one thing.

**The SSE arrow carries validated objects, not tokens.** That is
[ADR-0001](../adr/0001-server-side-validation-boundary.md), and it is why the
React package can be credential-free and model-agnostic.
