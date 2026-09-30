# Request lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant B as Browser<br/>(useGenerativeObject)
    participant R as Route handler
    participant G as streamObject
    participant N as negotiateStrategy
    participant C as RelaxClient
    participant X as relaxAI

    U->>B: click Generate
    B->>B: abort any in-flight stream
    B->>R: POST /api/ui { topic }

    R->>R: authorize(request)
    Note over R: returns a Response → short-circuit,<br/>no inference spent
    R->>R: inputSchema.safeParse(body)
    Note over R: fail → 400 with failing<br/>paths only, never values
    R->>R: toMessages(input)

    R->>G: streamObject(client, model, schema, messages)
    G->>N: negotiate(model)
    N->>N: capability table + allow/force
    N-->>G: tool_call · fallbacks [prompted_json]

    G->>C: streamChatCompletion(request)
    C->>C: redact(messages) if enabled
    C->>X: POST /chat/completions<br/>Bearer · tools · forced tool_choice · stream
    X-->>C: 200 text/event-stream
    C-->>G: chunks
    G-->>B: meta { strategy, model, requestId }

    loop each chunk
        X-->>C: delta.tool_calls[0].arguments
        C-->>G: chunk
        G->>G: accumulate → extract → repair → parse
        G->>G: safeParsePartial(finished = false)
        alt fatal issue
            G-->>B: error { schema_violation }
            G->>X: abort
        else changed and throttle elapsed
            G-->>B: patch { seq, ops }
            B->>B: applyPatch → re-render changed branches
        end
    end

    X-->>C: data: [DONE]
    G->>G: safeParsePartial(finished = true)

    alt schema passes
        G-->>B: complete { value, metadata }
    else schema fails
        Note over G: repair off-stream, not in-band
        G->>C: generateObject(forceStrategy = tool_call)
        C->>X: POST with assistant echo + issue list
        X-->>C: corrected document
        G-->>B: snapshot { value }
        G-->>B: complete { value, metadata }
    end

    B->>B: isStreaming = false
```

## Points worth reading twice

**Steps 4–6 precede any inference.** Authorisation, body validation and prompt
assembly all happen before a token is spent. A malformed request costs nothing, and
a failing body returns 400 with the failing *paths* — the values may be personal
data.

**Step 2 is not decoration.** A second click while a stream is open must abort the
first, or two streams race into one accumulator and the `seq` assertion fires.

**The abort in the fatal branch flows back to relaxAI.** `request.signal` is passed
through the route into `streamObject` into the client, so a closed tab or a fatal
validation issue cancels the upstream generation rather than paying for tokens
nobody will read.

**The repair is off-stream and emits a snapshot.** Patching a repaired document
against a broken one is not meaningful, so the protocol replaces the document
wholesale. That is also why downgrading is illegal once the first frame has been
sent — there is no frame meaning "forget everything I said".
