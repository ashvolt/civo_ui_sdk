# Phase 1 — Data Model

**Feature**: 001-generative-ui-sdk
**Date**: 2026-09-29

The SDK has no database. "Data model" here means the types that cross a
boundary — a module boundary, a process boundary, or the network — and the
invariants each one carries.

---

## Entity map

```
StructuredSchema ──targets── GenerateRequest ──selects── StructuringStrategy
       │                            │                          │
   derives                      negotiates                  produces
       │                            │                          │
  JsonSchema              ModelCapabilities            raw completion text
                                                              │
                                                        extract + repair
                                                              │
                                                       parsePartialJson
                                                              │
                                                     safeParsePartial ──► T
                                                              │
                                                        diffJson ──► UIStreamEvent
                                                              │
                                                     UIStreamAccumulator ──► T
```

A `UIRegistry` is a `StructuredSchema` factory whose value type is a
`UIDocument` — a tree of `UINode`. That is the only coupling between the
generic structured-generation layer and the generative-UI layer: everything
below `StructuredSchema` is schema-agnostic.

---

## 1. `StructuredSchema<T>`

The unit a generation targets.

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | 1–64 chars, `^[A-Za-z][A-Za-z0-9_-]{0,63}$` |
| `description` | `string?` | Sent to the model; the largest single lever on output quality |
| `schema` | `SchemaLike<T>` | Anything with a Zod-shaped `safeParse` |
| `jsonSchema` | `JsonSchema` | Derived, or supplied as an override |

**Invariants**

- `name` matches the pattern. OpenAI-compatible servers reject anything else, and
  the failure arrives as an opaque 400 — so it is validated at construction.
- `jsonSchema` describes the *same* shape as `schema`. Guaranteed by derivation;
  the caller owns it when overriding.
- Immutable once constructed.

**Why `SchemaLike` rather than `z.ZodType`**: core never imports Zod's runtime
for validation, only its types in the one module that needs them. Structural
typing keeps Zod a peer dependency and lets a caller substitute another library
with a compatible `safeParse`.

---

## 2. `ModelCapabilities`

What a model can be relied on to do. The SDK's *prior*, not a fact.

| Field | Type | Meaning |
|---|---|---|
| `jsonSchema` | `boolean` | Honours `response_format: json_schema` with real constrained decoding |
| `jsonObject` | `boolean` | Honours `response_format: json_object` |
| `toolCalling` | `boolean` | Honours `tools` + `tool_choice` |
| `streaming` | `boolean` | Honours `stream: true` |
| `reasoningTrace` | `boolean` | Emits a chain-of-thought preamble needing stripping |
| `contextWindow` | `number?` | Best known value, in tokens |
| `chatCapable` | `boolean` | `false` for embedding-only models |
| `note` | `string?` | Provenance, so an operator can see where a claim came from |

**Invariants**

- An unknown model id resolves to conservative defaults: `jsonObject` only. The
  floor strategy needs no server feature, so a wrong prior costs at most one
  wasted request.
- `chatCapable: false` fails *before* a request is spent, not after.
- Runtime observations override priors and persist for the process.

**Lifecycle**: a static family table (matched by regex, most-specific-first)
supplies the prior; `CapabilityRegistry.observe()` records what the server
actually did; `markStrategyUnsupported()` is the specific write the downgrade
path makes.

---

## 3. `StructuringStrategy`

| Field | Type |
|---|---|
| `name` | `"native_json_schema" \| "tool_call" \| "prompted_json"` |
| `buildRequest(ctx)` | → `ChatCompletionRequest` |
| `deltaOf(chunk)` | → JSON text carried by one streaming chunk |
| `finalOf(response)` | → JSON text from a completed response |

**Invariant**: `STRATEGY_PRECEDENCE` is ordered strongest-guarantee-first. The
ladder is a filter over it, never a re-ordering — so "which tier is stronger" has
exactly one definition.

**Why each strategy owns its own reader**: the three mechanisms return JSON in
three different places (`delta.content`, `delta.tool_calls[0].function.arguments`,
`message.content`). Putting the reader next to the request builder keeps that
pairing impossible to get wrong.

---

## 4. `UIRegistry<M>` and `ComponentSpec`

The application's closed component vocabulary.

```
ComponentSpec {
  description?: string          // shown to the model
  props:        ZodType<TProps> // validated per node
  children?:    "none" | "optional" | "required"   // default "none"
}
```

`UIRegistry` derives, from one `ComponentSpecMap`:

| Derived | Consumer |
|---|---|
| `nodeSchema` | recursive discriminated union over registered types |
| `documentSchema` | `{ root: UINode }` plus node/depth budget |
| `structuredSchema()` | the JSON Schema relaxAI is sent |
| `spec(type)` | the renderer's per-node lookup |
| `limits` | the renderer's depth ceiling |

**Invariants**

- At least one component. An empty vocabulary is a configuration error.
- The legal `type` set is closed at construction. This is the load-bearing
  security invariant: the model cannot name a component the application did not
  register, because the discriminated union has no branch for it.
- `children: "none"` forbids a `children` key entirely — `.strict()` objects, so
  an unexpected key fails rather than being ignored.
- `maxNodes` (default 500) and `maxDepth` (default 24) are enforced by an
  **iterative** walk. A recursive one overflows the stack while measuring, i.e.
  the guard fails before it can fire.

**Why one declaration feeds four consumers**: this is Principle II made
concrete. A registry, a JSON Schema, a validator and a renderer table maintained
separately is four things that must agree; here it is one thing read four ways.

---

## 5. `UINode`

```
UINode {
  type:      string      // must be a registered component name
  props:     Record<string, unknown>   // validated against that component
  children?: UINode[]    // per the component's ChildrenPolicy
  key?:      string      // 1-64 chars; reconciliation identity
}
```

**Invariants**

- `type` ∈ registry names.
- `props` passes that component's schema — including URL guards, which run at
  *validation* time so a `javascript:` URL fails the schema rather than reaching
  the DOM.
- Tree respects the document budget.

**Why `key` exists**: streaming means the renderer is called many times per
second with a growing tree. Without stable identity, a list that gains a child
remounts every sibling on every frame — inputs lose focus, animations restart.
The model supplies `key`; React uses it.

---

## 6. `UIStreamEvent` — the wire contract

Discriminated on `type`. This is the public contract at the network boundary and
the reason the React layer needs no knowledge of relaxAI.

| Variant | Payload | When |
|---|---|---|
| `meta` | `protocol`, `requestId`, `model`, `schema`, `strategy` | Once, first |
| `patch` | `seq`, `ops[]` | Incremental update |
| `snapshot` | `seq`, `value` | Full replacement |
| `complete` | `value`, `metadata` | Terminal success |
| `error` | `{code, message, retryable, requestId?}` | Terminal failure |

**Invariants**

- `meta` precedes every other frame.
- `seq` starts at 1 and increments by exactly 1 across `patch` and `snapshot`
  combined. A gap is unreconcilable — a patch assumes the exact document the
  server had — so the accumulator raises rather than render a mixture of two
  documents.
- Exactly one terminal frame; nothing follows it.
- `complete.value` has passed the full schema. This is the frame's entire
  meaning.
- No frame carries prompt text, completion text, or an API key. `error.message`
  is SDK-authored; validation details are reduced to codes and paths.
- `protocol` is versioned independently of the package version.

---

## 7. `JsonPatchOp`

An RFC 6902 subset: `add`, `replace`, `remove`. Paths are RFC 6901 pointers with
`~0`/`~1` escaping.

**Invariants**

- `applyPatch(before, diffJson(before, after))` deep-equals `after`. Property-tested
  over a realistic streaming sequence.
- Array removals are emitted highest-index-first, so every remaining index stays
  valid as ops apply in order.
- `applyPatch` structurally shares untouched subtrees, so React consumers keep
  referential equality on branches that did not change.

---

## 8. `GenerationMetadata`

| Field | Type | Why it is worth carrying |
|---|---|---|
| `requestId` | `string` | Correlates client, server and provider logs |
| `model` | `string` | The model that actually answered |
| `strategy` | `StructuringStrategyName` | The single most useful debugging signal |
| `downgradedFrom` | `StructuringStrategyName[]` | Makes silent degradation impossible |
| `repairAttempts` | `number` | Cost signal; a rising rate means a prompt or schema problem |
| `usage` | `CompletionUsage?` | Tokens, when the server reports them |
| `durationMs` | `number` | Wall clock, first byte to validated object |

**Invariant**: contains no prompt or completion text, so it is safe to log and to
return to the browser.

---

## 9. `RelaxUIError`

Every SDK failure. Callers branch on `code`, never on message text.

`config_invalid`, `sovereignty_violation`, `transport_error`, `http_error`,
`rate_limited`, `payment_required`, `timeout`, `aborted`, `stream_malformed`,
`no_content`,
`schema_violation`, `capability_unsupported`, `unrepairable`, `guard_rejected`.

Plus `retryable: boolean`, and optional `status`, `requestId`, `strategy`,
`details`.

**Invariants**

- `code` is stable across releases; adding one is a MINOR change, renaming one is
  MAJOR.
- `toJSON()` is safe to put in an HTTP response: it never carries prompt content.
- `retryable` means *this identical request could plausibly succeed* — it drives
  the HTTP retry loop, so it is a claim, not a hint.

---

## State machines

### Generation (batch)

```
negotiate ─► attempt(tier) ─► extract ─► parse ─► validate ─► DONE
                  │              │         │          │
                  │              └─────────┴──► repair ┘  (≤ maxRepairAttempts)
                  │
                  └─ capability rejection ─► next tier (remember: unsupported)
                  └─ other error ──────────► THROW
```

Only a *capability rejection* drops a tier. A model that can call tools but
writes bad arguments will not do better with a weaker mechanism — that is what
repair is for.

### Generation (stream)

```
negotiate ─► open stream ─► per delta: extract ─► parse ─► validate(partial)
                                                     │          │
                                          fatal ◄────┘          ├─ ok ─► emit frame
                                            │                   └─ pending ─► hold
                                            ▼
                                      error frame, stop

end of stream ─► validate(final)
                    ├─ ok ──────► complete frame
                    └─ invalid ─► off-stream repair ─► snapshot + complete
                                                    └─ fail ─► error frame
```

Downgrading is only legal **before the first frame**: once the client has started
rendering, a different strategy restarts the document from scratch.

Failures after the stream opens travel **in band** as an `error` frame with HTTP
200 — the status line was sent long before the failure happened.
