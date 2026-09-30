# Low-Level Design — relaxAI Generative UI SDK

**Version**: 1.0 · **Date**: 2026-09-29
**Companion documents**: [HLD](./hld.md) · [Security model](./security-model.md) · [ADRs](./adr/)

Module-by-module internals: the algorithms, their invariants, their complexity,
and the cases that motivated them. Where a decision looks odd, the reason is
stated — an unexplained oddity in a parser is how a bug survives review.

---

## 1. Module inventory

| Module | Lines* | Responsibility | Depends on |
|---|---|---|---|
| `types.ts` | ~150 | Wire types, strategy precedence, metadata | — |
| `errors.ts` | ~80 | `RelaxUIError` taxonomy | types |
| `guard/sovereignty.ts` | ~90 | Endpoint allowlist | errors |
| `guard/redaction.ts` | ~90 | Deterministic prompt redaction | — |
| `guard/url.ts` | ~110 | URL scheme/host guard | errors |
| `schema/zod-introspect.ts` | ~210 | Zod 3/4 normalisation | — |
| `schema/json-schema.ts` | ~290 | Zod → JSON Schema | introspect, errors |
| `schema/partial.ts` | ~140 | Streaming issue classification | types |
| `schema/define.ts` | ~60 | `StructuredSchema` construction | json-schema |
| `stream/sse.ts` | ~120 | SSE decoding | errors |
| `stream/partial-json.ts` | ~230 | Incremental JSON completion | types |
| `stream/json-patch.ts` | ~180 | RFC 6902 subset | types |
| `capability/registry.ts` | ~200 | Capability table + overrides | types |
| `capability/negotiate.ts` | ~130 | Ladder + rejection detection | registry, errors |
| `strategy/extract.ts` | ~120 | Reasoning/fence/chatter stripping | — |
| `strategy/index.ts` | ~230 | Three strategies | types, schema, capability |
| `client/http.ts` | ~230 | `fetch` + retry + timeout | errors |
| `client/relax-client.ts` | ~230 | relaxAI client | http, guards, sse |
| `protocol.ts` | ~170 | Event union + accumulator | json-patch |
| `generate.ts` | ~480 | Orchestration | everything |
| `ui/contract.ts` | ~230 | UI registry, budgets, prop helpers | schema, guard/url |
| `observability/metrics.ts` | ~70 | In-process counters | generate (types only) |

\* approximate, comments included.

---

## 2. `stream/partial-json.ts` — incremental JSON completion

The most delicate code in the SDK.

### 2.1 Problem

A model has emitted `{"title":"Quarterly rev`. The UI should show
"Quarterly rev" **now**. `JSON.parse` cannot help: this is not a document.

### 2.2 Approach

Single-pass scan maintaining a stack of frames. Each frame records where its last
*complete* member ended, so the tail can be rewound to a known-good point and the
open structures closed.

```ts
interface Frame {
  kind: "root" | "object" | "array";
  commit: number;                            // index just past last complete member
  expect: "value" | "key" | "colon" | "comma";
}
```

`expect` is what makes the scanner able to distinguish a key string from a value
string — the single most important distinction in the whole algorithm, because
they are rewound differently.

### 2.3 State transitions

| Current `expect` | Input | Action |
|---|---|---|
| `key` | `"` | open string, `stringIsKey = true` |
| `value` | `"` | open string, `stringIsKey = false` |
| `value` | `{` / `[` | push frame |
| any | `}` / `]` matching top | pop frame; member complete at `i+1` |
| `comma` | `,` | `expect ← key` (object) or `value` (array) |
| `colon` | `:` | `expect ← value` |
| `value` | other | begin a bare number/literal token |

A member completing always sets `frame.commit = i + 1` and `frame.expect =
"comma"`. That single assignment is what everything else rewinds to.

### 2.4 End-of-buffer decision table

| State at EOF | Cut point | Then |
|---|---|---|
| Inside a **value** string | `trimDanglingEscape(len)` | append `"`, close frames |
| Inside a **key** string | `top.commit` | close frames |
| Bare token that is complete (`true`, `42`) | `len` | close frames |
| Bare token incomplete (`tru`, `1.2e`, `-`) | `top.commit` | close frames |
| Otherwise (dangling `,` / `:` / nothing) | `top.commit` | close frames |

Closers are appended innermost-first, so `{"a":{"b":[1,2` → `{"a":{"b":[1,2]}}`.

### 2.5 The escape subtlety

Appending `"` to `{"s":"a\` yields `{"s":"a\"}` — an escaped quote, so the string
never closes and the parse fails. `trimDanglingEscape` handles two cases:

- **Odd trailing backslashes** → drop one. (Even means they are escaped pairs, so
  the tail is fine.)
- **Truncated `\uXXXX`** → look back six characters for a `\u` with fewer than
  four hex digits after it, and cut from there.

Both are tested directly, because both are invisible until they aren't.

### 2.6 Structural rejection

A genuinely malformed buffer (`{"a":1}]`, `{"a" 1}`) returns `null` rather than a
guess. Guessing here would hand a wrong document to a validator, which is worse
than admitting the stream is broken.

### 2.7 Complexity

O(n) per call, one pass, no allocation beyond the frame stack and the output
string. `parsePartialJson` tries a plain `JSON.parse` first, so a complete
document — the common case at end-of-stream — never enters the scanner.

---

## 3. `strategy/extract.ts` — the sanitising funnel

### 3.1 Ordered transformations

1. **Strip reasoning wrappers** (when `capabilities.reasoningTrace`):
   `<think>…</think>`, `<thinking>`, `<reasoning>`,
   `<|channel|>analysis` … `<|channel|>final`.
2. **Strip markdown fences**, including an unclosed one.
3. **Take from the first `{` or `[`.**
4. **Drop trailing chatter** after the final `}`/`]`, unless what follows looks
   like it is still mid-document (starts with `,` or `"`).

### 3.2 The open-wrapper rule

While a reasoning block is still open, `stripReasoning` returns everything
*before* it — usually the empty string. This matters more than it looks:

```
<think>The user wants revenue, so I should use a Metric with
```

If that prose reached `completePartialJson`, the `{` inside a sentence would be
treated as the start of a document. Returning nothing is the correct answer to
"what JSON has arrived so far": none.

### 3.3 Why O(n²) is the right trade here

`JsonTextAccumulator.jsonText()` re-runs the whole funnel over the whole buffer
on every delta. For a document of n bytes arriving in k chunks that is O(n·k).

The alternative is a resumable, stateful stripper that handles four reasoning
formats, an unclosed fence, and a chatter tail — all incrementally, all
restartable mid-token. That is a great deal of subtle code whose bugs would look
exactly like model misbehaviour.

Generated UI specs are kilobytes. At 4 KB and 500 chunks this is ~2M character
comparisons per generation, against a network round-trip measured in seconds. The
trade is not close. It is documented in the source so that someone streaming a
megabyte knows where to look.

---

## 4. `schema/partial.ts` — validating the unfinished

### 4.1 The inversion

Rather than weaken the schema, run it and classify what it complains about.

```ts
classifyIssue(issue) → "pending" | "fatal"
```

| Issue | Class | Reasoning |
|---|---|---|
| `invalid_type`, input `undefined` | pending | Key has not arrived |
| `too_small` | pending | String/array still filling |
| `invalid_union`, `invalid_union_discriminator` | pending | Branch not yet determined |
| `invalid_enum_value`, `invalid_value`, `invalid_literal` | pending | Enum member half-spelled |
| `invalid_string`, `invalid_format` | pending | Format incomplete (a partial email is not yet an invalid one) |
| `custom` (refinements) | pending | A refinement over incomplete data is meaningless |
| `unrecognized_keys` | **fatal** | A key not in the schema will never become one |
| `too_big` | **fatal** | Over-long cannot shorten |
| `invalid_type` with a value present | **fatal** | Wrong type is wrong now |

`safeParsePartial(schema, value, finished)` promotes every pending issue to fatal
when `finished` is true. One function, two meanings of "valid", no second schema.

### 4.2 Version tolerance, for free

The classifier reads only `issue.code` and whether the input was `undefined`.
Zod 3 reports `received: "undefined"`; Zod 4 reports `input: undefined`. One
helper covers both:

```ts
function isMissingValue(issue) {
  if (issue.code !== "invalid_type") return false;
  if (issue.received === "undefined" || issue.received === "null") return true;
  return "input" in issue && issue.input === undefined;
}
```

This fell out of the design rather than being engineered in — which is usually a
sign the design is right.

---

## 5. `schema/json-schema.ts` — Zod → JSON Schema

### 5.1 Recursion

Component trees are recursive, so the emitter must handle cycles. `z.lazy()`
returns the same schema instance each call, so identity is a reliable cycle key.

```
build(schema):
  if schema ∈ seen:      return { $ref: "#/$defs/" + seen[schema] }
  if kind is container:   name ← unique(hint); seen[schema] ← name
  body ← buildBody(...)
  if name and body mentions "#/$defs/" + name:
      defs[name] ← body; return { $ref: ... }
  else drop the reserved name and return body inline
```

The final step matters: a non-recursive object would otherwise acquire a
pointless `$defs` entry and an indirection, making the schema harder for both
humans and models to read.

### 5.2 Optionality

```ts
isOptionalLike(schema)  // optional | default | catch, through readonly/branded/pipe/nullable
```

A field is omitted from `required` when it is optional-like — except in strict
mode, where OpenAI's contract requires every property listed in `required`
(nullability expresses absence instead).

### 5.3 Deliberate failure

`z.map`, `z.set`, `z.promise`, `z.function` throw `config_invalid` naming the kind
and pointing at the `jsonSchema` override. Emitting `{}` instead would tell the
model "anything goes" for a field with real constraints — a silent mis-description
that surfaces as an unexplained validation failure much later.

### 5.4 Zod 3 array bounds

Zod 3 stores array length on the array's own def (`_def.minLength.value`) rather
than in `checks`, unlike every other constraint; Zod 4 moved it into `checks`.
`arrayLength()` reads both. This was found by a failing test, not by reading the
source, which is the argument for the test.

---

## 6. `stream/json-patch.ts`

### 6.1 Ops

`add`, `replace`, `remove` only. `move`/`copy`/`test` buy nothing for a document
that grows monotonically, and every op we ship is one a reviewer can check by eye.

### 6.2 Array diffing

Positional, not keyed:

```
shared = min(before.length, after.length)
for i < shared:          recurse
for i from before.length-1 down to after.length:   remove /path/i
for i from before.length to after.length-1:        add    /path/i
```

Removals descend so that every remaining index stays valid as ops apply in order.

Positional diffing is O(n) and produces minimal patches for the append-only case,
which is what a model streaming a list actually does. A mid-list insert produces a
larger patch than a keyed diff would — correct, just not minimal.

### 6.3 Structural sharing

`applyOne` copies only the nodes along the mutated path; siblings keep their
references. A React component subscribed to an untouched branch therefore keeps
referential equality and skips re-rendering. Asserted directly:

```ts
expect(patched.a).toBe(before.a);
expect(patched).not.toBe(before);
```

### 6.4 Round-trip invariant

`applyPatch(before, diffJson(before, after))` deep-equals `after`, tested over a
realistic streaming sequence and over root-type changes.

---

## 7. `capability/` — negotiation

### 7.1 Table shape

Regex family patterns, most-specific-first, each entry carrying a `note` recording
where the claim came from.

| Pattern | jsonSchema | tools | reasoning | Note |
|---|---|---|---|---|
| `/embedding/` | ✗ | ✗ | ✗ | Not a chat model — fails before a request |
| `/^deepseek-r1/` | ✗ | ✗ | ✓ | `<think>` preamble; tool use unreliable |
| `/^deepseek-v4/` | ✓ | ✓ | ✓ | Frontier MoE, ~1M context |
| `/^deepseek/` | ✗ | ✓ | ✓ | V3 family default |
| `/^glm/` | ✓ | ✓ | ✓ | Built for agentic workloads |
| `/^gpt-oss/` | ✗ | ✓ | ✓ | Harmony channels |
| `/^llama-4-maverick/` | ✗ | ✓ | ✗ | Tool calling is the reliable path |
| `/^llama-4/`, `/^llama-3/` | ✗ | ✓ | ✗ | Family defaults |
| unknown | ✗ | ✗ | ✗ | `jsonObject` only — conservative |

Unknown models get the floor, and are promoted only by evidence. The asymmetry is
deliberate: over-claiming costs a failed request, under-claiming costs a few
tokens.

### 7.2 Rejection detection

```ts
isCapabilityRejection(error, strategy)
```

Requires a 400/404/422/501 **and** a message mentioning a generic
"not supported"/"unsupported"/"not implemented"/"unknown field", or a
strategy-specific token (`response_format`, `json_schema`, `guided` for tier 1;
`tool`, `function` for tier 2).

Matching message text is unlovely and unavoidable: OpenAI-compatible servers are
inconsistent here. The alternatives were to downgrade on any 400 (masking genuine
bad requests) or never (abandoning the ladder). The worst case of the heuristic is
a **missed** downgrade, which surfaces as a normal error — it fails safe. It is one
exported, tested function, easy to extend as new phrasings appear.

---

## 8. `generate.ts` — orchestration

### 8.1 `generateObject`

```
negotiate → ladder
for tier in ladder:
  try:
    for repair in 0..maxRepairAttempts:
      response ← client.chatCompletion(strategy.buildRequest(...))
      text     ← extract(strategy.finalOf(response))
      parsed   ← parsePartialJson(text)
      result   ← safeParsePartial(schema, parsed.value, finished = true)
      if result.ok: return { object, metadata }
      if repair < max: messages ← appendRepairTurn(base, text, issues); continue
    break                                   # repairs exhausted on this tier
  catch e:
    if isCapabilityRejection(e, tier) and another tier exists:
        registry.markStrategyUnsupported(model, tier); continue
    throw e
throw lastFailure
```

Two rules, both load-bearing:

- **Only a capability rejection drops a tier.** Exhausting repairs breaks out
  instead, because a weaker mechanism will not fix bad content.
- **The rejection is written back to the registry**, so the next call in the
  process skips the dead tier.

### 8.2 The repair turn

```
[...base messages,
 { role: "assistant", content: truncate(previousOutput, 8000) },
 { role: "user", content: "That response did not match the required schema:\n" +
                          formatIssues(issues) +
                          "\n\nReturn the corrected JSON document only." }]
```

Echoing the model's own output back matters: asked to "fix it" without being
shown what it wrote, a model regenerates from scratch and reproduces the fault.
Output is truncated at 8 KB so a runaway generation cannot blow the context.

### 8.3 `streamObject`

Per delta: accumulate → extract → parse → compare with last emitted → validate
partial → emit.

| Condition | Action |
|---|---|
| Extractor yields `""` | `noop` — reasoning still open |
| Parse invalid/empty | `noop` — mid-token |
| Value unchanged | `noop` — no frame for no change |
| `validation.status === "invalid"` | **abort**: error frame, cancel upstream |
| Throttle not elapsed | skip, coalesce into the next frame |
| Otherwise | emit `patch` (or `snapshot` if the patch would be larger) |

`seq` decrements on `noop` so numbering stays gapless — a client treats a gap as
unrecoverable, so an incremented-then-unused `seq` would be a protocol violation
caused by an optimisation.

### 8.4 Downgrading mid-stream is illegal

```ts
if (!opened && isCapabilityRejection(error, strategyName) && tier + 1 < ladder.length)
```

The `!opened` guard is the whole rule: once the client has a `meta` frame and
patches, a different strategy restarts the document from scratch, and there is no
frame in the protocol that means "forget everything I said".

### 8.5 End-of-stream

```
final ← parse(accumulator.jsonText())
validation ← safeParsePartial(schema, final, finished = true)
if ok:
    if final ≠ last emitted:  emit flush frame     # throttle may have held it back
    emit complete
else:
    repaired ← generateObject({ ...options, forceStrategy: currentTier })
    emit snapshot(repaired) ; emit complete
```

The off-stream repair emits a **snapshot**, never a patch: patching a repaired
document against a broken one is not meaningful.

### 8.6 `toSSEStream`

`ReadableStream` with a `pull` that advances the generator one event per call, so
backpressure propagates from the socket to the parser to the upstream read. A
slow client slows the pipeline rather than buffering it. `cancel()` calls
`events.return()`, which aborts the upstream request.

---

## 9. `client/http.ts`

### 9.1 Structure

`attemptOnce` resolves with a discriminated outcome instead of throwing; `send`
owns the retry loop. An earlier version threw from inside the try block and the
catch re-entered the loop, so a non-retryable error was silently retried. The
split makes that shape impossible to write.

```ts
type Attempt =
  | { kind: "ok"; response: Response }
  | { kind: "fail"; error: RelaxUIError; retryAfter: string | null };
```

### 9.2 Timeout vs abort

Both arrive as an `AbortError`, and they mean opposite things — a timeout is
retryable, a caller abort must not be. A `timedOut` flag set by the timer
distinguishes them; `controller.signal.reason` is not reliable across runtimes.

### 9.3 Backoff

```
delay = retryAfter ?? round(random() * min(base · 2^attempt, maxDelay))
```

Full jitter, not plain exponential: a fleet of pods that all hit a 429 must not
retry in lockstep. `Retry-After` wins — a rate limit is the server's call.

`random` and `sleep` are injectable, so the retry suite is deterministic and
instant.

---

## 10. `ui/contract.ts`

### 10.1 Deriving the node schema

```ts
const nodeSchema = z.lazy(() => {
  const variants = names.map(name => z.object({
    type:  z.literal(name),
    key:   z.string().min(1).max(64).optional(),
    props: specs[name].props,
    ...(policy === "none"     ? {}
      : policy === "required" ? { children: z.array(nodeSchema).min(1) }
      :                         { children: z.array(nodeSchema).optional() }),
  }).strict());

  return variants.length === 1 ? variants[0] : z.discriminatedUnion("type", variants);
});
```

- `z.lazy` keeps the reference stable so the JSON Schema emitter can find the
  cycle.
- `.strict()` makes an unexpected key a validation failure. Without it, a
  `children` array on a leaf, or an `onClick`, would be silently dropped — and
  silently dropped is how something later gets silently spread onto a DOM node.
- `z.discriminatedUnion` gives O(1) branch selection and, crucially, error
  messages that name the failing component instead of listing every branch.

### 10.2 The type-system problem worth recording

`ComponentSpecMap` must hold heterogeneous specs. The obvious
`Record<string, ComponentSpec<never>>` fails: a concrete
`z.object({ label: z.string() })` is not assignable to `ZodType<never>`.

The fix keeps precision without `any`:

```ts
props: z.ZodType<TProps, z.ZodTypeDef, unknown>
type ComponentSpecMap = Record<string, ComponentSpec>;   // TProps = Record<string, unknown>
```

Widening the **input** parameter to `unknown` — everything is assignable to
`unknown` — makes the map assignable while `safeParse` still returns the precise
props type at the point of use. The constitution forbids `any` in exported
signatures; this honours it rather than working around it.

### 10.3 `urlString`

```ts
z.string()
 .superRefine((v, ctx) => { if (sanitizeUrl(v, policy) === null) ctx.addIssue(...) })
 .transform(v => sanitizeUrl(v, policy)!)
```

Refine **and** normalise. The consequence is that `javascript:alert(1)` fails
*schema validation* — before the renderer exists, before the frame is sent, before
the DOM is involved. `z.string().url()` would accept it: it is a syntactically
valid URL.

### 10.4 `measureTree` is iterative on purpose

A recursive walk overflows the stack on a 200,000-deep tree — i.e. the depth guard
fails *before* it can fire, which is the one failure mode a depth guard must not
have. Explicit stack, plus a hard 100,000-node iteration cap so a pathological
document is not walked to completion. Tested against a 200,000-deep tree.

---

## 11. `protocol.ts` — `UIStreamAccumulator`

One implementation of "what does the document look like now", shared by the React
hook, non-React consumers and the server's own tests. A second implementation
would drift, and a client that disagrees with the server about the document is a
rendering bug nobody can reproduce.

```ts
private assertSeq(seq: number): void {
  if (seq !== this.lastSeq + 1) throw new Error(`UI stream out of order: ...`);
}
```

Throwing rather than tolerating is correct: a patch assumes the exact document the
server held, so a gap cannot be reconciled. Rendering a mixture of two documents
would be worse than an error.

---

## 12. React layer

### 12.1 `useGenerativeObject`

- `callbacks.current = options` every render, so the memoised `submit` always sees
  current callbacks without being invalidated by an inline arrow in the caller's
  JSX.
- `submit` aborts any in-flight generation first — a second click must not race
  two streams into one accumulator.
- Unmount aborts: a stream nobody will read should not keep an inference running,
  and `setState` after unmount is a warning at best.
- Optional client-side `schema` re-validation of the completed object. The server
  already validated it; this catches "the endpoint is not the one you think it
  is", which has happened in real deployments.

### 12.2 `GenerativeUI`

Per node, in order: depth check → `registry.spec(type)` and component lookup →
`spec.props.safeParse` → render. Any failure routes to `onInvalidNode`, which
defaults to rendering nothing.

Keying: `child.key ?? `${child.type}:${index}``. Model-supplied keys are what stop
a streaming list from remounting every sibling on every frame — without them,
inputs lose focus and animations restart several times a second.

There is no `dangerouslySetInnerHTML` anywhere in the package, and CI greps for it.
Not a default — an absence.

---

## 13. Next.js layer

`createGenerativeUIRoute` sequence:

1. `authorize?` → a returned `Response` short-circuits before any inference.
2. `request.json()` → 400 on malformed body.
3. `inputSchema.safeParse` → 400 on failure, echoing **failing paths only**. The
   values may be personal data; the paths are what a developer needs.
4. `toMessages(input, request)` → the application owns prompt assembly.
5. `streamObject` with `signal: request.signal` → a closed tab cancels the
   generation.
6. `toSSEStream` → 200 with streaming headers.

`model`, `schema`, `system` and `sampling` come from the closure, never the
request. The type signature makes the alternative unexpressible.

`X-Accel-Buffering: no` is on the response because Nginx and several CDNs buffer
unknown content types by default, turning a streaming route into a slow
non-streaming one with nothing in the logs to explain it.

---

## 14. Test strategy

| Suite | Tests | Emphasis |
|---|---|---|
| `partial-json` | 21 | Rewind rules, escapes, structural rejection, **every prefix** of a realistic document |
| `json-patch` | 12 | Round-trip, array ops, structural sharing |
| `json-schema` | 14 | Constraints, unions, `$defs` recursion, deliberate throw |
| `guards` | 19 | Every refusal path, including "the insecure opt-in must not unlock a remote host" |
| `ui-contract` | 15 | Unknown component, bad props, extra props, `javascript:`, budgets, 200k-deep tree |
| `generate` | 17 | Each tier, downgrade + persistence, repair, full ladder walk, no downgrade on 401 |
| `react/stream` | 9 | Split frames, CRLF, comments, non-events, out-of-order refusal |
| `react/renderer` | 11 | Refusals, escaping, keying, defaults |
| `next/route` | 10 | Input rejection, smuggled model/system, in-band errors, status mapping |
| **Total** | **128** | |

Two techniques worth naming:

**Prefix exhaustion.** For a realistic document, assert that *every* prefix parses
without throwing and that the last one equals the real document. This finds the
cases no human would think to type — a truncation inside `\u00`, a cut between a
key's closing quote and its colon.

**Refusal assertions.** Every guard has a test asserting the *refusal*, not just
the happy path. A URL guard that accepts good URLs and is never shown a bad one is
not tested.

Every I/O seam is injected (`fetch`, `sleep`, `random`, `now`), so the suite
exercises real code paths — the actual `RelaxClient`, the actual retry loop — with
no network and no wall-clock waiting. There are no module mocks.

---

## 15. Complexity summary

| Operation | Time | Space |
|---|---|---|
| `completePartialJson` | O(n) | O(depth) |
| `parsePartialJson` (complete doc) | O(n) via `JSON.parse` | O(n) |
| `extractJsonText` | O(n) | O(n) |
| Streaming, whole generation | O(n·k) — see §3.3 | O(n) |
| `diffJson` | O(n) | O(ops) |
| `applyPatch` per op | O(depth) | O(depth) |
| `measureTree` | O(n), no recursion | O(width) |
| `toJsonSchema` | O(schema nodes) | O(defs) |
| `negotiateStrategy` | O(1) | O(1) |
| `redact` | O(n · rules) | O(n) |
