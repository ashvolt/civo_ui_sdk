# Phase 1 — Data Model

**Feature**: 002-provider-agnostic-inference
**Date**: 2026-10-05

As in feature 001, "data model" means the types that cross a boundary and the
invariants each carries. This feature adds five and changes three.

---

## Entity map

```
                    ┌──────────────── ProviderProfile ────────────────┐
                    │ id · baseURL · egress · sovereign · local       │
                    │ capabilities? · schemaDialect? · timeoutMs?     │
                    └───────┬───────────────┬───────────────┬─────────┘
                       describes       refines           narrows
                            │               │               │
  application ──selects──► InferenceClient  │               │
                            │        CapabilityRegistry   SchemaDialect
                            │        (one per endpoint)      │
                            │               │                │
                            └──► negotiateStrategy      adaptJsonSchema
                                        │                    │
                                 StructuringStrategy ◄── WireSchema
                                        │
                              (feature 001 pipeline, unchanged)
                                        │
                                  UIStreamEvent ──► FrameLog
```

Everything below `StructuringStrategy` is feature 001's and does not know a
provider exists. That is the design: the provider layer sits entirely *above*
the engine and feeds it three things — a client, a capability record, and a
schema to put on the wire.

---

## 1. `ProviderProfile` (new)

What the SDK needs to know about one kind of endpoint. Pure data; no I/O.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `^[a-z][a-z0-9-]{0,31}$`. Appears on the wire |
| `label` | `string` | For logs, error messages, the application's UI |
| `baseURL` | `string` | Absolute. Used when neither option nor environment supplies one |
| `baseURLEnv` | `string[]?` | Environment variables consulted, first match wins |
| `apiKeyEnv` | `string[]?` | As above, for the key |
| `requiresApiKey` | `boolean` | When true, a missing key is `config_invalid` |
| `egress` | `SovereigntyPolicy` | Allowlist + insecure-transport opt-in |
| `sovereign` | `boolean` | A jurisdictional guarantee, stated — never inferred |
| `local` | `boolean` | The default endpoint is on this machine |
| `capabilities` | `Partial<ModelCapabilities>?` | Applied to every *chat* model on this endpoint |
| `schemaDialect` | `SchemaDialect?` | Keywords the constrained decoder cannot honour |
| `timeoutMs` | `number?` | Per-request default for this provider |
| `note` | `string?` | Provenance: measured, or a prior |

**Invariants**

- P1. `sovereign && egress.allowInsecureTransport` is rejected at definition. A
  profile cannot claim a jurisdictional guarantee and permit plaintext.
- P2. Frozen after `defineProvider`. A profile cannot be edited into a different
  endpoint after a client was built from it.
- P3. Every built-in profile with `local: true` has `egress` equal to
  `LOOPBACK_ONLY_POLICY`. Asserted by test, not by convention.
- P4. Exactly one built-in profile has `sovereign: true`.

**Built-in**

| id | Base URL | Key | Sovereign | Local | Refinements |
|---|---|---|---|---|---|
| `relaxai` | `https://api.relax.ai/v1` | required | yes | no | none |
| `ollama` | `http://127.0.0.1:11434/v1` | optional | no | yes | `jsonSchema: true`; dialect drops `pattern` (measured) |
| `lmstudio` | `http://127.0.0.1:1234/v1` | optional | no | yes | none (prior) |
| `llamacpp` | `http://127.0.0.1:8080/v1` | optional | no | yes | none (prior) |

---

## 2. `ProviderDescriptor` (new)

The subset of a profile that travels: `{ id, label, sovereign, local }`. Carried
by every client, so an application can show it without holding the profile.

**Invariant** — D1. Derived from the profile by `describeProvider`; there is no
other way to obtain one from the SDK, so a client cannot report a sovereignty its
profile does not declare.

---

## 3. `InferenceClient` (new)

The only thing the engine depends on.

| Member | Type |
|---|---|
| `provider` | `ProviderDescriptor` |
| `capabilities` | `CapabilityRegistry` |
| `schemaDialect` | `SchemaDialect?` |
| `listModels(options?)` | `Promise<ModelDescriptor[]>` |
| `chatCompletion(request, options?)` | `Promise<ChatCompletionResponse>` |
| `streamChatCompletion(request, options?)` | `AsyncIterable<ChatCompletionResponse>` |

**Invariants**

- C1. Structural. No base class, no brand: an object with these members is an
  inference client.
- C2. The engine tolerates a missing `provider` at runtime (a JavaScript caller's
  incomplete object). The cost is the label, not a thrown `TypeError` mid-stream.

**Implementations shipped**: `OpenAICompatibleClient` (any profile) and
`RelaxClient` (the same class with the profile fixed to `relaxai`).

---

## 4. `SchemaDialect` and the wire schema (new)

```ts
interface SchemaDialect { unsupportedKeywords: readonly string[] }
```

`adaptJsonSchema(schema, dialect) → { schema, dropped }`.

**Invariants**

- W1. **Validator unchanged.** The wire schema is used only to build a request.
  `StructuredSchema.schema` validates every document regardless (FR-112).
- W2. **Only narrows the description.** Keywords are removed; none is added or
  rewritten. A document the full schema accepts, the wire schema accepts.
- W3. **Structure-aware.** A keyword is removed where it is a keyword. Names
  inside `properties`, `$defs`, `patternProperties`, `definitions` and
  `dependentSchemas` are never treated as keywords; values of `const`, `enum`,
  `default`, `examples` and `required` are copied verbatim.
- W4. **Identity when idle.** With nothing to remove, the *same object* is
  returned, so "no adaptation" is cheap to detect and costs no allocation.
- W5. **Never silent.** A non-empty `dropped` produces a `schema_adapted` trace
  event naming the provider and the keywords.
- W6. **Server-enforced tiers only.** `native_json_schema` and `tool_call` use the
  wire schema. `prompted_json` embeds the full schema: the model reads it, the
  server compiles nothing, so telling it less gains nothing.

---

## 5. `CapabilityRegistry` (changed)

Feature 001: `capabilities(model) = baseline(model) ⊕ overrides(model)`.

Now three layers, weakest first:

```
capabilities(model) = baseline(model)                       name-based prior
                    ⊕ endpointDefaults   if chatCapable     what this server adds
                    ⊕ overrides(model)                      what was observed
```

**Invariants**

- R1. `endpointDefaults` is never applied to a model whose prior is
  `chatCapable: false`. A server that can constrain decoding still cannot make an
  embeddings model answer a chat request.
- R2. **Scoped.** `capabilityRegistryFor("<provider id>|<origin>")` returns one
  registry per endpoint. Two clients of the same endpoint share it; two endpoints
  never do (FR-110).
- R3. relaxAI at its public origin keeps the process-wide
  `defaultCapabilityRegistry`, so feature 001 applications that seed or inspect it
  are unaffected (FR-123).
- R4. An observation outranks an endpoint default. A rejection learned at runtime
  is not un-learned by the profile.

---

## 6. `UIStreamMetaEvent` and `GenerationMetadata` (changed, additive)

Both gain `provider?: string` — the profile id. Optional, so a protocol-1 client
written before this feature is unaffected, and a hand-written inference client
that omits it produces a frame without the field rather than an error.

**Sequencing, restated.** `meta` is still the first frame of any stream that
carries a document. Two things are now explicit that feature 001 left implicit:

- M1. `meta` is written *with the first document frame*, not on the first
  upstream chunk. Its `strategy` is therefore always the mechanism that produced
  the document — including after an empty-handed downgrade (FR-115).
- M2. A stream that failed before any mechanism engaged is a **lone `error`
  frame**. There is no strategy for a `meta` to name. (A mechanism that engaged
  and then failed is `meta` then `error`.)

---

## 7. `GenerationTrace` (changed, additive)

New member: `{ type: "schema_adapted"; provider: string; dropped: string[] }`.

Also a correction: `streamObject` now emits `strategy_selected`,
`strategy_downgraded` and `validated`. Feature 001 emitted them from
`generateObject` only, so a streaming route's `onEvent` never saw a downgrade.

---

## 8. Downgrade causes (changed)

| Cause | Detected by | Remembered? | Safe when |
|---|---|---|---|
| Capability **rejection** (feature 001) | `isCapabilityRejection` on a 4xx/501 | yes, per endpoint | before the endpoint starts answering |
| **Empty-handed** (new) | the mechanism ended with no document text | **no** | before any document frame was sent |

**Invariant** — G1. Empty-handed is not remembered because it is a property of
one answer, not of the endpoint. Demoting a tier for the life of the process on
the strength of one blank response would turn a flaky small model into a
permanently degraded one.

**Excluded** — `finish_reason: "length"` with no document text is `truncated`,
never a downgrade: a weaker mechanism with the same budget fails the same way.

---

## 9. `FrameLog` (new, tooling only)

`{ index, atMs, bytes, event }[]`, built by an observer (`onFrame` in the hook;
the generator's consumer in the inspector). Not part of the wire protocol and
never sent anywhere.

**Checked by the inspector**

1. at most one `meta`; first unless the stream is a lone `error`
2. `seq` starts at 1 and increases by exactly 1 across `patch` and `snapshot`
3. exactly one terminal frame, and it is last
4. every intermediate document is tolerated by the schema under streaming rules
5. replaying the frames through `UIStreamAccumulator`, then validating, yields
   exactly the `complete` frame's value

---

## 10. Partial-document monotonicity (changed)

Found by reading a frame log, not by design review.

**Invariant** — J1. For every prefix `p` of a JSON document and every longer
prefix `q`, each member path present in `parsePartialJson(p)` is present in
`parsePartialJson(q)`.

Feature 001 violated it for numbers: `12` → `12.` → `12.5` parsed as
`12` → *(member dropped)* → `12.5`, which reached the wire as an `add`, a
`remove` and another `add`, and reached the user as a value flickering out and
back. A number is now held at its longest valid prefix while its next character
is in flight. A half-written **literal** (`tru`) is still dropped, which does not
violate J1: it was never shown.
