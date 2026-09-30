# The structuring ladder

```mermaid
stateDiagram-v2
    direction TB
    [*] --> Negotiate: generateObject()

    state Negotiate {
        [*] --> Lookup
        Lookup --> Filter: apply allow / force
        Filter --> [*]
        Lookup: consult capability table
    }

    Negotiate --> Tier1: jsonSchema = true
    Negotiate --> Tier2: else toolCalling = true
    Negotiate --> Tier3: else
    Negotiate --> Fail: chatCapable = false

    Tier1: native_json_schema
    Tier1: response_format.json_schema
    Tier2: tool_call
    Tier2: forced tool_choice
    Tier3: prompted_json
    Tier3: schema in system prompt

    Tier1 --> Extract
    Tier2 --> Extract
    Tier3 --> Extract

    Tier1 --> Tier2: capability rejection — remember jsonSchema = false
    Tier2 --> Tier3: capability rejection — remember toolCalling = false

    Tier1 --> Fail: other error (401, 429, 500)
    Tier2 --> Fail: other error
    Tier3 --> Fail: other error

    Extract: strip reasoning, fences, chatter
    Extract --> Validate
    Validate --> Success: schema passes
    Validate --> Repair: schema fails
    Repair --> Extract: re-ask with issue list
    Repair --> Fail: repair budget spent

    Success --> [*]
    Fail --> [*]
```

## The two rules that make this safe

**Only a capability rejection drops a tier.** The `Tier1 --> Fail` edges matter as
much as the downgrade edges: a 401, a 429 or a 500 propagates unchanged. Silently
downgrading on any error would mask an auth failure as a quality problem, and a
downgrade is not free — it costs the guarantee.

**Exhausting repairs does not drop a tier.** Notice that `Repair --> Fail` exits
the machine rather than stepping down. A model that can call tools but writes bad
arguments will not do better with a weaker mechanism; the fault is in the content,
not the channel, and repair is the tool for content.

## Why the "remember" annotations matter

Each downgrade writes back to the process-wide `CapabilityRegistry`. Without that,
a wrong prior costs one wasted request *per call*. With it, it costs one per model
per process — which is why it is safe to ship optimistic priors for models we
could not verify against the live API.

## Where the floor sits

`prompted_json` requires no server feature at all: only a chat model that can be
asked for JSON. That is why a completely wrong capability table degrades to "one
wasted request and a slightly larger prompt" rather than to a failure.
