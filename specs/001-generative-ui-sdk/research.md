# Phase 0 — Research

**Feature**: 001-generative-ui-sdk
**Date**: 2026-09-29

This phase resolves the unknowns that the plan depends on. Each item states what
had to be decided, what was chosen, and what was rejected — the rejections are
the useful part, because they are what a reviewer would otherwise ask about.

---

## R1. The relaxAI API surface

**Question**: what exactly are we building against?

**Findings** (from Civo's published material — see *Sources*):

| Property | Value |
|---|---|
| Base URL | `https://api.relax.ai/v1` |
| Auth | `Authorization: Bearer <key>` |
| Compatibility | Stated as 1:1 with the OpenAI API |
| Chat | `POST /chat/completions`, SSE when `stream: true` |
| Models | `GET /models`, `GET /models/{id}` |
| Also exposed | embeddings, audio transcription, deep research |
| Official SDKs | Python, TypeScript, Go — plus any OpenAI-compatible client |
| Jurisdiction | UK data centres; processing stays in UK legal jurisdiction |
| Catalogue (observed) | Llama 4 Maverick 17B-128E, Llama 4 Scout, Llama 3.3 70B, DeepSeek R1, DeepSeek V3.1 Terminus, DeepSeek V4 Pro, GPT-OSS-120b, GLM 4.6, Kimi, Mistral-7b-embedding |
| Indicative pricing | from ~£0.10/M input, ~£0.60/M output; Maverick ~£0.15/£0.80 with ~500k context |

**Consequence for the design**: protocol compatibility means we do *not* need a
bespoke wire format — an OpenAI-shaped client works. But the catalogue is
open-weight models, and that is where the compatibility claim stops being
useful: `response_format: {type: "json_schema"}` is a *server* feature (guided
decoding), not a protocol feature. Whether any given relaxAI model honours it,
honours only `json_object`, or honours neither, is not discoverable from the
protocol. **This gap is the product.**

**Verification limitation, stated plainly**: this environment's egress policy
blocks `relax.ai` and `civo.com`, so the above is assembled from Civo's public
newsroom, docs and tutorial pages via search rather than from live calls, and
no request was made against the live API. The design is therefore built to
*tolerate* uncertainty rather than to assume any of it:

- capability claims live in one overridable table (`capability/registry.ts`),
  each annotated with its provenance, not scattered through request builders;
- every claim is falsifiable at runtime — a rejection downgrades and is
  remembered;
- the floor strategy needs no server feature at all, so an entirely wrong table
  costs one wasted request per model per process, never a failure.

`scripts/probe-models.ts` exists for exactly this: `pnpm build && RELAX_API_KEY=...
pnpm probe` measures each catalogue model and prints where reality disagrees with
the table above, plus a paste-ready registry seed. It is itself verified against a
stub in CI (`pnpm probe:selftest`). It has not been run against the live API from
here — that is T-056c, and it should land before a 1.0 publish.

---

## R2. Structured output on open-weight models

**Question**: how do we reliably get schema-conformant JSON?

**Options considered**:

1. **`response_format: json_schema`** — server constrains decoding to the
   schema. Strongest possible guarantee: an invalid token is never sampled, so
   shape violations are *impossible*, not merely unlikely. Requires the server to
   implement guided decoding (vLLM/SGLang do, behind a flag, per model).
2. **Tool calling** — express the schema as a function signature and force
   `tool_choice`. Very widely implemented, and models are heavily post-trained on
   it, so arguments arrive as clean JSON with no prose or fences. No hard
   guarantee: the model can emit malformed arguments.
3. **Prompted JSON** — put the schema in the prompt and ask. Works on any chat
   model. Weakest: prose, fences, commentary and hallucinated fields all happen.
4. **Grammar/EBNF** — some servers accept a grammar. Not part of the
   OpenAI-compatible surface, so not portable across the catalogue.
5. **Re-ask-until-valid only** — no structuring mechanism, just retry.
   Unbounded cost, and no better than (3) plus repair.

**Decision**: implement 1, 2 and 3 as a **precedence ladder** with automatic
downgrade, plus a bounded repair loop under whichever tier is active. Reject 4
as non-portable; reject 5 as strictly worse than 3.

**Why a ladder rather than picking one**: picking (1) fails on most of the
catalogue today. Picking (3) throws away a real guarantee on the models that
offer it, and burns tokens restating a schema the server could have enforced for
free. The ladder is the only option that is correct on every model *and* optimal
on the good ones. (→ ADR-0002)

**Rejected refinement**: probing each model's capabilities at startup with a
throwaway request. Rejected because it adds a cold-start round-trip per model,
and the first real request discovers the same fact for free.

---

## R3. Parsing a JSON document that has not finished arriving

**Question**: how do we render a partial object mid-stream?

**Options considered**:

1. **Wait for the complete document.** Simple, and abandons the product
   requirement — a 4-second blank screen is the thing we are trying to fix.
2. **Character-level repair + `JSON.parse` per tick.** Track string/escape state
   and bracket depth, rewind the half-written tail, synthesise the missing
   closers, parse the result.
3. **A full streaming/event-driven JSON parser (SAX-style).** Emits tokens as
   they arrive; the consumer assembles the tree.
4. **An off-the-shelf partial-JSON library.**

**Decision**: option 2.

**Why not 3**: a SAX parser gives token events, but the renderer needs a
*document*. Building and mutating the tree from token events is the same work
plus a second representation to keep consistent. It also makes "what does the UI
look like right now" a function of accumulated side effects rather than of the
buffer — much harder to test, and impossible to test by the method we actually
used (assert over every prefix of a realistic document).

**Why not 4**: it is ~150 lines with sharp edges we want tests on, and Principle
V puts a hard price on a core runtime dependency.

**The rules that took the most thought**, all of which are tested:

- a half-written **value** string is kept and closed — `{"title":"Quarterly rev`
  → `{"title":"Quarterly rev"}` — because progressively rendering prose is the
  entire point;
- a half-written **key** is discarded — `{"a":1,"ti` → `{"a":1}` — because
  `{"ti": …}` would misrepresent the object's shape to a validator and to React;
- a dangling `,` or `:`, an incomplete literal (`tru`), and a number that cannot
  yet terminate (`1.2e`, `-`) all rewind to the frame's last committed member;
- a dangling escape (`"a\`) or truncated `\uXY` is trimmed before the closing
  quote is appended, or the repair itself produces invalid JSON.

---

## R4. Validating an intentionally incomplete object

**Question**: Zod rejects a partial object. How do we validate mid-stream?

**Options considered**:

1. **Derive a deep-partial schema.** Walk Zod's internals, rebuild every node as
   optional.
2. **Two schemas, authored by the user** — a strict one and a loose one.
3. **Validate only at completion**, render unvalidated partials.
4. **Run the real schema and classify the issues.**

**Decision**: option 4.

**Why not 1**: `.deepPartial()` was removed in Zod 4, so it must be hand-rolled;
it breaks on refinements, transforms, branded types and discriminated unions;
and it differs between majors, which collides with NFR-007. It is a large,
fragile surface for a problem that has a smaller solution.

**Why not 2**: violates Principle II outright — two schemas that must agree.

**Why not 3**: gives up failing fast. A wrong-typed field detected on token 4
should not cost the remaining 2,000 tokens.

**How option 4 works**: run `safeParse`, then partition the issues.
"Not written yet" issues (missing required key, `too_small`, unresolved union,
half-spelled enum, failed refinement over incomplete data) are tolerated while
the stream is open and promoted to fatal when it closes. "Wrong shape" issues
(`invalid_type` with a value actually present, `unrecognized_keys`, `too_big`)
are fatal immediately.

This also turns out to be *version-agnostic*: it only reads `issue.code` and
whether the input was `undefined`, which both majors report (Zod 3 as
`received: "undefined"`, Zod 4 as `input: undefined`). One helper handles both.

---

## R5. Server → browser transport

**Question**: how do frames reach the client?

**Options considered**:

| Option | Verdict |
|---|---|
| Re-send the whole object per frame | Rejected: O(n²) bytes; a 40 KB spec becomes megabytes |
| RFC 6902 JSON Patch (subset) | **Chosen** |
| Custom binary delta format | Rejected: unreadable in devtools, needs a decoder to debug |
| Raw token passthrough (Vercel AI SDK style) | Rejected: moves parsing and guarding to the client — violates Principle IV |
| WebSocket | Rejected: needs a stateful server; SSE survives CDNs and works with plain `fetch` |

**Decision**: SSE frames, each one JSON, carrying a JSON Patch of `add` /
`replace` / `remove` ops. Snapshot mode available, and chosen automatically when
a patch would be larger than the document.

Only three ops: `move`, `copy` and `test` buy nothing here, and every op we ship
is one a reviewer can verify by eye. Arrays diff positionally — a model appends
to a list far more often than it splices into one.

**Why not raw tokens, at more length**: this is the load-bearing decision of the
whole design. Handing tokens to the browser means the browser must parse them,
validate them, and guard them. All three then run in an environment the attacker
controls, and every application re-implements them. Parsing server-side costs one
extra hop of latency and buys a real trust boundary. (→ ADR-0001)

---

## R6. Preventing model output from becoming an XSS vector

**Question**: what stops a generated tree from executing script?

**Threat model**: the model reads retrieval context, user text and tool output.
None is trusted. Assume an attacker can influence what the model writes.

**Attack surfaces and mitigations**:

| Surface | Mitigation |
|---|---|
| Model names a dangerous component (`script`, `iframe`) | Type union closed at schema-construction time from the app's registry; validation rejects, renderer rejects again |
| Model injects markup into a text prop | Rendered as React text content; no `dangerouslySetInnerHTML` path exists |
| `href: "javascript:alert(1)"` | URL guard at *validation* time, so it fails the schema before any render |
| `java\0script:` obfuscation | Control characters rejected outright |
| `data:text/html` payload | Data URLs off by default; when on, media type must be an allowlisted image |
| Props spread onto a DOM element | Renderer hands validated props to the app's component; the app never spreads |
| 200k-node tree (DoS) | Node/depth budget, enforced by an *iterative* walk — a recursive one overflows while measuring, so the guard would fail before firing |
| Exfiltration via image `src` | Optional host allowlist on URL props |

**Decision**: defence in depth. Every check runs on the server before a frame is
sent *and* in the renderer before a component is called. The duplication is
deliberate: each check is a map lookup or a `safeParse`, and the failure mode it
guards against — a malformed tree reaching the DOM because one layer was
misconfigured — is not cheap. (→ ADR-0004)

---

## R7. Runtime targets

**Question**: what must core run on?

Next.js route handlers deploy to Node, the Vercel Edge runtime, and Cloudflare
Workers; tests run in Vitest under Node. All four support `fetch`,
`ReadableStream`, `TextEncoder`/`TextDecoder`, `AbortController` and `URL`.

**Decision**: core targets exactly that intersection. No `node:` imports, no
runtime dependency except the caller's Zod.

**Rejected**: wrapping the official `openai` package. It assumes OpenAI's
capability set (so it cannot express the ladder), and it would put a second HTTP
stack and a second retry policy inside a library whose pitch is a controlled
egress path. What we write instead is small enough to audit in an afternoon.
(→ ADR-0003)

---

## R8. Zod 3 and Zod 4 in one SDK

**Question**: which major do we require?

Enterprise codebases do not move a major version to adopt an SDK, and Zod 3 is
still the dominant install. Requiring 4 would exclude the buyer; requiring 3
would date immediately.

**Decision**: support both, via a single introspection adapter
(`schema/zod-introspect.ts`) that normalises the differences:

| Concern | Zod 3 | Zod 4 |
|---|---|---|
| Type tag | `_def.typeName` (`"ZodString"`) | `_zod.def.type` (`"string"`) |
| Object shape | `_def.shape()` (function) | `def.shape` (value) |
| Array element | `_def.type` | `def.element` |
| Literal | `_def.value` | `def.values` (array) |
| Enum | `_def.values` | `def.entries` |
| Default | `_def.defaultValue()` | `def.defaultValue` |
| Array bounds | `_def.minLength.value` | in `def.checks` |
| Missing-key issue | `received: "undefined"` | `input: undefined` |

Every reach into Zod's internals is confined to that one file, so a future major
has exactly one place to fix.

---

## R9. Reasoning traces and response wrappers

**Question**: what do the catalogue's models actually emit around the JSON?

- **DeepSeek R1** — `<think>…</think>` before the answer.
- **GPT-OSS** — harmony channel markers (`<|channel|>analysis` …`final`).
- **GLM 4.6** — reasoning-capable; may emit a preamble.
- **Llama 4 / 3.x** — no reasoning block, but frequently a markdown fence and a
  courteous sentence either side.

**Decision**: a sanitising funnel — strip known reasoning wrappers, strip
fences (including an unclosed one), take from the first `{`/`[`, and drop
trailing chatter after the closing bracket. Reasoning-stripping is driven by the
model's capability record rather than applied blindly.

One subtlety that matters for streaming: while a reasoning block is still
*open*, the extractor returns the empty string. Handing prose to a partial JSON
parser produces garbage; returning nothing produces a correct "not started yet".

---

## Sources

- [Civo — relaxAI product page](https://www.civo.com/ai/relaxai)
- [Civo newsroom — relaxAI API with 1:1 OpenAI compatibility](https://www.civo.com/newsroom/relax-api-with-openai-compatibility)
- [relaxAI docs — introduction](https://relax.ai/docs/getting-started/introduction)
- [relaxAI docs — models & pricing](https://relax.ai/docs/getting-started/pricing)
- [relaxAI docs — list models](https://relax.ai/docs/endpoints/models/list)
- [relaxAI API overview](https://relax.ai/api)
- [Civo Learn — deploy a lightweight AI utility with relaxAI](https://www.civo.com/learn/deploy-lightweight-ai-utility-on-civo-with-relaxai)
- [Civo Learn — data-driven recommendations with relaxAI](https://www.civo.com/learn/building-data-driven-recommendation-system-with-relaxai)
- [datacentrenews.uk — Civo launches relaxAI API for UK data sovereignty](https://datacentrenews.uk/story/civo-launches-relaxai-api-to-boost-uk-data-sovereignty-in-ai)
- [OpenAI — structured outputs guide](https://platform.openai.com/docs/guides/structured-outputs) (for the `json_schema` / strict-mode semantics we mirror)
- [RFC 6902 — JSON Patch](https://www.rfc-editor.org/rfc/rfc6902) and
  [RFC 6901 — JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901)
