# Streaming pipeline

```mermaid
flowchart TB
    A["SSE chunk from relaxAI"] --> B{"strategy.deltaOf"}
    B -->|"native / prompted"| B1["choices[0].delta.content"]
    B -->|"tool_call"| B2["delta.tool_calls[0]<br/>.function.arguments"]

    B1 --> C["JsonTextAccumulator.push"]
    B2 --> C

    C --> D["stripReasoning<br/><i>returns '' while a block is open</i>"]
    D --> E["stripCodeFences<br/><i>handles an unclosed fence</i>"]
    E --> F["slice from first { or [<br/>drop trailing chatter"]

    F --> G{"text empty?"}
    G -->|"yes"| NOOP1["noop — nothing to parse yet"]
    G -->|"no"| H["completePartialJson<br/>rewind tail · close frames"]

    H --> I{"repairable?"}
    I -->|"no"| NOOP2["noop — mid-token"]
    I -->|"yes"| J["JSON.parse"]

    J --> K{"changed since<br/>last emitted?"}
    K -->|"no"| NOOP3["noop — no frame for no change"]
    K -->|"yes"| L{"safeParsePartial<br/>finished = false"}

    L -->|"fatal issue"| M["error frame<br/><b>abort upstream</b>"]
    L -->|"pending only"| N{"frameIntervalMs<br/>elapsed?"}

    N -->|"no"| NOOP4["hold — coalesce into next frame"]
    N -->|"yes"| O["diffJson vs last emitted"]

    O --> P{"patch bigger<br/>than document?"}
    P -->|"yes"| Q["snapshot frame"]
    P -->|"no"| R["patch frame"]

    Q --> S["browser: accumulator"]
    R --> S
    S --> T["applyPatch<br/>structural sharing"]
    T --> U["React render<br/>untouched branches skip"]

    classDef stop fill:#fff4f4,stroke:#c53030
    classDef skip fill:#f6f6fb,stroke:#8a8aa3
    class M stop
    class NOOP1,NOOP2,NOOP3,NOOP4 skip
```

## The four `noop` paths

Most deltas produce no frame, and that is the design working rather than failing:

- **Reasoning still open.** DeepSeek R1 can spend hundreds of tokens inside
  `<think>` before the document starts. `stripReasoning` returns the empty string
  throughout, which is the correct answer to "what JSON has arrived": none. Handing
  that prose to the parser would find a `{` inside a sentence.
- **Mid-token.** `{"a":1,"ti` has no repairable form that includes the partial key,
  so the frame is skipped rather than emitting a document with a half-named field.
- **No change.** Two deltas can land inside the same incomplete value without
  changing the parsed document. No frame for no change.
- **Throttled.** At `frameIntervalMs: 50`, roughly one frame in ten survives on a
  fast model. Nothing is lost: the flush at end-of-stream emits whatever the
  throttle held back.

## The one stop path

A **fatal** validation issue — wrong type, unknown key — aborts the upstream
request immediately. This is the concrete payoff of
[ADR-0005](../adr/0005-streaming-partial-validation.md): a `score: "nine"` detected
on token 4 does not cost the remaining 2,000 tokens. A *pending* issue at the same
point is expected and ignored.
