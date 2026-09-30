# Implementation Plan: Generative UI SDK for relaxAI

**Branch**: `001-generative-ui-sdk` | **Date**: 2026-09-29 | **Spec**: [spec.md](./spec.md)
**Constitution**: [v1.0.0](../../.specify/memory/constitution.md)

---

## Summary

Ship a three-package TypeScript SDK that makes relaxAI a plug-and-play backend
for streaming, schema-enforced generative UI.

The technical core is a **capability-negotiating structuring ladder** wrapped
around a **streaming partial-JSON pipeline** with a **closed component
vocabulary**. Everything else — the client, the route adapter, the React hook —
is thin.

The insight the design turns on: relaxAI's OpenAI compatibility solves transport
and solves nothing else. Its catalogue is open-weight models whose support for
constrained decoding is uneven and undiscoverable from the protocol. That gap is
precisely what stands between an enterprise frontend team and generative UI, and
it is what this SDK closes.

---

## Technical Context

| | |
|---|---|
| **Language** | TypeScript 5.7, `strict`, `noUncheckedIndexedAccess` |
| **Runtime targets** | Node ≥ 20.11, Vercel Edge, Cloudflare Workers, Bun, Deno |
| **Core dependencies** | none at runtime (Zod is a peer) |
| **React peer** | `^18.2 \|\| ^19` |
| **Zod peer** | `^3.23 \|\| ^4` |
| **Build** | tsup → ESM + CJS + `.d.ts` |
| **Test** | Vitest; `react-dom/server` for renderer tests (no DOM needed) |
| **Package manager** | pnpm workspaces |
| **Upstream** | relaxAI `https://api.relax.ai/v1`, OpenAI-compatible |

---

## Constitution Check — pre-design

| Principle | Assessment | Verdict |
|---|---|---|
| I. Sovereignty is not a setting | Host allowlist at construction; https-only; zero SDK-initiated egress; in-process observability only; optional deterministic redaction | PASS |
| II. The schema is the contract | One Zod schema derives JSON Schema, validator, TS type and renderer table | PASS |
| III. Capability is negotiated | Overridable capability table + three-tier ladder + runtime learning + metadata reporting | PASS |
| IV. Model output is untrusted | Closed type union, per-node prop validation, URL guard at validation time, no raw-HTML path, iterative budget check, server-side guarding | PASS |
| V. The edge is a target | `fetch`-only core, zero runtime deps, no `node:` imports, injectable I/O | PASS |
| VI. Spec precedes implementation | constitution → spec → clarify → this plan → tasks → implement | PASS |
| VII. Every behaviour has a test | Contract tests for protocol/ladder/guards; parsers property-tested over all prefixes; refusal paths asserted | PASS |

No violations. No Complexity Tracking entries required.

---

## Project Structure

```
.specify/memory/constitution.md
specs/001-generative-ui-sdk/
  spec.md  research.md  data-model.md  plan.md  quickstart.md  tasks.md
  contracts/{ui-stream-protocol,relaxai-upstream,public-api}.md
docs/
  hld.md  lld.md  security-model.md  api-reference.md  troubleshooting.md
  diagrams/*.md            (Mermaid)
  adr/0001..0006-*.md
packages/
  core/src/
    types.ts errors.ts protocol.ts generate.ts index.ts
    client/{http,relax-client}.ts
    capability/{registry,negotiate}.ts
    strategy/{index,extract}.ts
    schema/{define,json-schema,partial,zod-introspect}.ts
    stream/{sse,partial-json,json-patch}.ts
    ui/contract.ts
    guard/{sovereignty,redaction,url}.ts
    observability/metrics.ts
  react/src/{index,use-generative-object,renderer.tsx,stream}.ts
  next/src/{index,route}.ts
examples/next-app/            (Edge-runtime reference app)
```

**Structure decision**: a monorepo with three packages rather than one.
A single package would force React into the dependency graph of a Cloudflare
Worker that only wants `generateObject`, and would make Principle V
unenforceable — you cannot assert "no `node:` imports in core" if core and the
Next adapter are the same build.

---

## Design decisions

Each links to its ADR, which carries the alternatives and the rejection reasons.

### D1 — Server-side parsing boundary → [ADR-0001](../../docs/adr/0001-server-side-validation-boundary.md)

The browser receives typed events describing a validated object, never model
tokens. Costs one hop of latency; buys a real trust boundary and stops every
application re-implementing parse + validate + guard in the one place an attacker
can edit them.

### D2 — Three-tier structuring ladder → [ADR-0002](../../docs/adr/0002-capability-negotiated-structuring-ladder.md)

`native_json_schema` → `tool_call` → `prompted_json`, downgrading on capability
rejection, remembering per process, reporting in metadata. The only option that
is correct on every model in the catalogue *and* optimal on the good ones.

### D3 — Hand-rolled client, not the `openai` package → [ADR-0003](../../docs/adr/0003-no-openai-sdk-dependency.md)

The official SDK assumes OpenAI's capability set, so it cannot express the
ladder; and it would put a second HTTP stack and retry policy inside a library
whose pitch is a controlled egress path.

### D4 — Closed component vocabulary → [ADR-0004](../../docs/adr/0004-closed-component-vocabulary.md)

The legal `type` set is closed at schema-construction time from the
application's own registration. Generative UI moves the XSS surface from "what
the developer wrote" to "what the model was persuaded to write"; an allowlist is
the mitigation that actually addresses that.

### D5 — Issue classification, not deep-partial schemas → [ADR-0005](../../docs/adr/0005-streaming-partial-validation.md)

Run the real schema mid-stream and partition the issues into "not written yet"
(tolerated while open) and "wrong shape" (fatal immediately). Avoids rebuilding
Zod's tree, works across both majors, and keeps fail-fast.

### D6 — JSON Patch on the wire → [ADR-0006](../../docs/adr/0006-json-patch-streaming-transport.md)

Snapshot-per-frame is O(n²) bytes. A three-op RFC 6902 subset, with automatic
snapshot fallback when a patch would be larger than the document.

---

## Phase plan

### Phase 0 — Research → [research.md](./research.md)

R1 relaxAI surface · R2 structured-output mechanisms · R3 partial JSON parsing ·
R4 partial validation · R5 transport · R6 XSS threat model · R7 runtime targets ·
R8 Zod 3/4 · R9 reasoning traces. All resolved; no open questions.

### Phase 1 — Design → [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

Nine entities with stated invariants; three contracts (wire protocol, upstream
assumptions, public API); a quickstart that is the acceptance test for "under 30
lines of application code".

### Phase 2 — Tasks → [tasks.md](./tasks.md)

46 dependency-ordered tasks, tests before implementation per Principle VII.

### Phase 3 — Implementation

Executed in task order. Verification gate: `pnpm verify`
(typecheck + test + build) plus a real `next build` of the reference app.

---

## Constitution Check — post-design

| Principle | Evidence in the delivered design | Verdict |
|---|---|---|
| I | `guard/sovereignty.ts` runs in the `RelaxClient` constructor; `redact()` is pure and model-free; `MetricsCollector` has no transport; grep confirms the only outbound hosts are the two documented endpoints | PASS |
| II | `createUIRegistry` derives four artefacts from one `ComponentSpecMap`; `toJsonSchema` throws rather than approximate, with an explicit override | PASS |
| III | `CapabilityRegistry` is data + overrides; `negotiateStrategy` filters `STRATEGY_PRECEDENCE`; `markStrategyUnsupported` persists; `metadata.downgradedFrom` reports | PASS |
| IV | Closed discriminated union; `.strict()` objects; `urlString()` fails validation not render; no `dangerouslySetInnerHTML` anywhere; `measureTree` iterative; renderer re-validates | PASS |
| V | `packages/core` has zero `dependencies`; no `node:` import; `fetch`, `sleep` and `now` all injectable; example app runs `export const runtime = "edge"` | PASS |
| VI | This document, gated both ends | PASS |
| VII | 128 tests: 21 partial-parser (incl. every prefix of a realistic document), 12 patch round-trip, 14 JSON Schema, 19 guard (incl. every refusal), 15 UI contract, 17 orchestrator (incl. full ladder walk), 20 React, 10 route | PASS |

### Complexity Tracking

No principle was violated, so no justification table is required.

One judgement call worth recording, since a reviewer will notice it:
`isCapabilityRejection` matches on upstream **error message text**, not only on
status codes. OpenAI-compatible servers are inconsistent about how they signal an
unsupported feature. The alternatives were to downgrade on any 400 (which would
mask genuine bad requests) or never to downgrade (which abandons the ladder). The
heuristic's worst case is a missed downgrade that surfaces as a normal error, so
it fails safe — and it is confined to one exported, tested function.

---

## Verification

| Gate | Command | Result |
|---|---|---|
| Types | `pnpm typecheck` | clean |
| Tests | `pnpm test` | 128 passing |
| Build | `pnpm build` | ESM + CJS + types, 3 packages |
| Reference app | `next build` in `examples/next-app` | compiles; `/api/ui` on Edge |
| No `node:` in core | `grep -rn "from \"node:" packages/core/src` | no matches |
| No raw HTML sink | `grep -rn "dangerouslySetInnerHTML" packages` | no matches |
| Core has no runtime deps | `packages/core/package.json` → `dependencies` | absent |

---

## Known limitations

Stated because a plan that claims no limitations is not a plan.

1. **Capability priors are unverified against the live API.** This environment's
   egress policy blocks `relax.ai`, so the table is built from Civo's published
   documentation. The architecture is designed so that a wrong prior costs one
   wasted request per model per process, never a failure — but T-046
   (`scripts/probe-models.ts`) should replace priors with measurements before
   publication.
2. **`toJsonSchema` covers a subset of Zod.** Objects, arrays, tuples, records,
   unions, discriminated unions, literals, enums, optional/nullable/default,
   lazy recursion, and string/number constraints. `z.map`, `z.set`, `z.promise`
   and `z.function` throw with an explicit message pointing at the `jsonSchema`
   override. Deliberate: failing loudly beats mis-describing a shape to a model.
3. **Array diffing is positional.** A mid-list insert produces a larger patch
   than a keyed diff would. Correct, just not minimal; models append far more
   often than they splice.
4. **Repair defaults to one round.** A second re-ask rarely succeeds where the
   first failed and costs a full generation. Configurable.
5. **No client-side rate limiting.** `authorize` is the seam; quota policy
   belongs to the application.
