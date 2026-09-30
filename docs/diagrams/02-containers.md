# Containers and module dependencies

```mermaid
graph TB
    subgraph next["relax-ui-next"]
        Route["route.ts<br/>handler factories"]
    end

    subgraph react["relax-ui-react"]
        Hook["use-generative-object.ts"]
        Rend["renderer.tsx"]
        RStream["stream.ts"]
    end

    subgraph core["relax-ui-core"]
        Gen["generate.ts<br/><b>orchestration</b>"]
        Proto["protocol.ts"]
        UI["ui/contract.ts"]

        Neg["capability/negotiate.ts"]
        CReg["capability/registry.ts"]
        Strat["strategy/index.ts"]
        Ext["strategy/extract.ts"]

        Def["schema/define.ts"]
        JSch["schema/json-schema.ts"]
        Part["schema/partial.ts"]
        Intro["schema/zod-introspect.ts"]

        PJ["stream/partial-json.ts"]
        JP["stream/json-patch.ts"]
        SSE["stream/sse.ts"]

        Cl["client/relax-client.ts"]
        HTTP["client/http.ts"]

        Sov["guard/sovereignty.ts"]
        Red["guard/redaction.ts"]
        URLg["guard/url.ts"]

        Err["errors.ts"]
        Ty["types.ts"]
    end

    Route --> Gen
    Hook --> RStream --> Proto
    Rend --> UI
    Hook --> Proto

    Gen --> Neg --> CReg
    Gen --> Strat --> Ext
    Gen --> Part
    Gen --> PJ
    Gen --> JP --> Proto
    Gen --> Cl --> HTTP
    Cl --> Sov
    Cl --> Red
    Cl --> SSE
    UI --> Def --> JSch --> Intro
    UI --> URLg
    Part --> Ty
    HTTP --> Err

    classDef leaf fill:#f2fbf4,stroke:#2f855a
    classDef orch fill:#fff8ec,stroke:#b7791f
    class Sov,Red,URLg,Err,Ty,Intro leaf
    class Gen orch
```

## Reading the dependency direction

**Guards and types are leaves** (green). Nothing in the SDK depends on them
transitively in a way that could route around them, and they are individually
testable with no fixtures. `guard/sovereignty.ts` has exactly one caller — the
`RelaxClient` constructor — and that constructor is the only way to reach the
network. `guard/url.ts` has exactly one caller in the UI path — `urlString()` —
and that is the only way a URL prop enters a schema.

**`generate.ts` is the only orchestrator** (amber). It is the single place where
negotiation, strategy, extraction, parsing, validation and diffing meet. That
concentration is deliberate: the ordering constraints between those steps are the
subtle part of the system, and they are easier to review in one file than
distributed across six.

**The three packages form a chain, not a web.** `react` never imports `next`;
`next` never imports `react`; neither imports the other's internals. That is what
lets a Cloudflare Worker use `generateObject` without React entering its bundle.
