# Implementation Plan: Provider-Agnostic Inference

**Branch**: `002-provider-agnostic-inference` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)
**Constitution**: [v1.1.0](../../.specify/memory/constitution.md) — amended by this feature

---

## Summary

Make the inference endpoint a selectable **provider** behind a narrow
**interface**, so the SDK is exercised end to end against an open-weight model
on the developer's own machine; then use that to check how frames are actually
created by a real model, fix what the check finds, and record it as a
reproducible video.

The insight the design turns on: *the SDK was already decoupled from relaxAI
everywhere except its type signatures, its defaults, and its capability table.*
The ladder, the partial parser, the validator and the wire protocol never knew
which endpoint they served. So the work is not a rewrite — it is naming an
abstraction the reference app had been faking with a placeholder API key — and
the interesting half of the feature is what running against a real local model
then exposed. Capability turned out to belong to the *(endpoint, model)* pair;
an endpoint turned out to accept a schema and silently not enforce it; and four
defects in frame creation turned up that scripted streams could never have
shown, because scripted streams are well-behaved.

---

## Technical Context

| | |
|---|---|
| **Language** | TypeScript 5.7, `strict`, `noUncheckedIndexedAccess` |
| **Runtime targets** | unchanged — Node ≥ 20.11, Vercel Edge, Cloudflare Workers, Bun, Deno |
| **Dependencies** | none added, in any package (NFR-101) |
| **Build** | tsup → ESM + CJS + `.d.ts`, unchanged |
| **Test** | Vitest (unit); Playwright (browser, two projects); `pnpm frames` (live) |
| **Bench** | Ollama 0.35.0, Windows 11, CPU: `qwen2.5:3b/7b/14b`, `llama3.2:1b/3b`, `qwen3:4b` |
| **Wire protocol** | stays at version 1; every change additive (NFR-103) |

---

## Constitution Check — pre-design

Run against v1.0.0, which is what was in force when the feature was proposed.

| Principle | Assessment | Verdict |
|---|---|---|
| I. Sovereignty is not a setting | v1.0.0 says "`api.relax.ai` is the only default". A selectable provider is at minimum an expansion of that sentence, and "loosely coupled" could be read as licence to weaken the guard | **FAIL as written** |
| II. The schema is the contract | A provider-specific wire schema is a second description of the shape. Derived, but looser | **AT RISK** |
| III. Capability is negotiated | Strengthened: capability becomes per-endpoint, which is what the measurements say it is | PASS |
| IV. Model output is untrusted | Untouched. Validation stays server-side and stays the application's schema | PASS |
| V. The edge is a target | No new dependency, no `node:` import; profiles are data | PASS |
| VI. Spec precedes implementation | Constitution → spec → clarify → plan → tasks → implement, with measurement ahead of the spec because the clarifications needed answers | PASS |
| VII. Every behaviour has a test | Each defect reproduced against the old code before its fix | PASS |

**Resolution of I.** Not worked around: the constitution is amended in the same
change, as its Governance section requires (v1.1.0, MINOR). The guard, the https
rule and "no call the application did not ask for" are untouched. What is added:
a non-relaxAI endpoint must be an explicit act; no fallback between providers;
every profile carries its own allowlist; local profiles are loopback-only; every
profile states whether it is sovereign and that fact travels with the result.
The amended principle is *stricter* about what a non-sovereign endpoint may be
mistaken for than v1.0.0 was.

**Resolution of II.** Accepted as a deviation and recorded in Complexity
Tracking below, rather than argued away.

---

## Project Structure

```
.specify/memory/constitution.md                      v1.0.0 → v1.1.0
specs/002-provider-agnostic-inference/
  spec.md  research.md  data-model.md  plan.md  quickstart.md  tasks.md
  contracts/provider-profile.md
docs/
  adr/0007-provider-profiles-and-inference-interface.md
  adr/0008-wire-schema-dialects.md
  demo/generative-ui-local-model.{webm,png}
packages/core/src/
  provider/profile.ts            new — ProviderProfile, built-ins, defineProvider
  provider/model-selection.ts    new — moved from the example, plus discovery
  client/inference-client.ts     new — the interface the engine depends on
  client/openai-compatible-client.ts   new — was the body of relax-client.ts
  client/relax-client.ts         now a 20-line subclass
  client/env.ts                  new
  schema/dialect.ts              new — adaptJsonSchema
  capability/registry.ts         endpointDefaults; capabilityRegistryFor
  generate.ts                    lazy meta, empty-handed downgrade, error frames
  stream/partial-json.ts         monotonic numbers
  stream/sse.ts                  cancel the body on early exit
packages/next/src/route.ts       client: InferenceClient
packages/react/src/use-generative-object.ts   onFrame, provider
scripts/inspect-frames.ts        new — `pnpm frames`
examples/next-app/
  app/provider.ts                rebuilt on the SDK's profiles
  app/frame-inspector.tsx        new
  e2e/{dashboard,legacy-runtime}.spec.ts   two projects, two app instances
  demo/record.spec.ts            new — `pnpm demo:record`
```

**Structure decision**: the provider layer lives in **core**, not in a fourth
package. A separate `relax-ui-providers` would have kept core's export list
shorter, and would have made it possible to depend on core *without* the egress
guard that the profiles exist to feed — which is the one combination Principle I
cannot allow. Profiles are data and add no dependency, so Principle V has no
objection to them being here.

---

## Design decisions

### D1 — An interface, plus a profile → [ADR-0007](../../docs/adr/0007-provider-profiles-and-inference-interface.md)

`InferenceClient` is what the engine depends on; `ProviderProfile` is frozen
data describing an endpoint. Kept separate so that a different wire protocol is
"implement four methods", and a different OpenAI-compatible server is "write
eight fields". `RelaxClient` survives as the profile-fixed subclass, so no
feature-001 application changes.

### D2 — The guard runs for every provider; the environment cannot widen it → ADR-0007

A local profile is not exempt from `assertSovereignEndpoint` — it carries a
loopback-only policy. A profile's environment variable may move its base URL;
only `sovereignty` in code may change who can be dialled. An unknown provider
name throws.

### D3 — One capability registry per endpoint → ADR-0007

`baseline(model) ⊕ endpointDefaults ⊕ observed`, scoped by
`(provider id, origin)`. Fixes a latent feature-001 bug in passing: one
endpoint's learned rejection no longer applies to another serving a model of
the same name.

### D4 — Send a constrained decoder only what it can enforce → [ADR-0008](../../docs/adr/0008-wire-schema-dialects.md)

A profile declares keywords its decoder cannot honour; server-enforced tiers get
a wire schema without them; the application's schema still validates
everything; the adaptation is reported on every generation it applies to.

### D5 — `meta` is written with the first document frame

Not on the first upstream chunk. It is the only way `meta.strategy` can be true
after a mechanism was accepted and then produced nothing. `meta` is still first.

### D6 — Two kinds of downgrade, remembered differently

A *rejection* is a fact about the endpoint: remembered per endpoint, safe only
before the endpoint starts answering. An *empty-handed* tier is a fact about one
answer: not remembered, safe until the first document frame is sent.

### D7 — The demo is a script, and its subject is a real model

Playwright's recorder driving the reference app against local Ollama. A stand-in
endpoint is available for machines with no model and is labelled as such on
screen. No `ffmpeg`, no manual steps.

---

## Phase plan

### Phase 0 — Research → [research.md](./research.md)

R1 where the coupling actually is · R2 constrained decoding on Ollama · R3 the
real schema, and the bisection to `pattern` · R4 tool-call streaming · R5
reasoning models · R6 interface vs base class · R7 which runtimes get a profile ·
R8 how to record · R9 whether a constrained tier should also show the model its
schema (measured, and rejected). Seven of the nine were answered by measurement.

### Phase 1 — Design → [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

Five new entities, three changed, each with invariants. One contract. A
quickstart whose first section is the feature's primary success criterion.

### Phase 2 — Tasks → [tasks.md](./tasks.md)

61 tasks; 58 complete, 3 outstanding and stated. Measurement precedes
governance precedes code.

### Phase 3 — Implementation

Executed in task order. Each frame-creation defect reproduced against the
pre-change code before its fix was written.

---

## Constitution Check — post-design

Against v1.1.0.

| Principle | Evidence in the delivered design | Verdict |
|---|---|---|
| I | `assertSovereignEndpoint` in `OpenAICompatibleClient`'s constructor, every provider. Tests assert: unknown name throws; remote host on a local profile refused over https and over plaintext; `OLLAMA_BASE_URL` cannot widen the allowlist; a keyless provider sends no `Authorization`; `RelaxClient` ignores `RELAX_UI_PROVIDER`; exactly one built-in is sovereign. `meta.provider` on the wire. CI's egress grep unchanged and passing | PASS |
| II | The application's schema is the only validator, before and after. `adaptJsonSchema` only removes, is structure-aware, returns the same object when idle, and is reported. Deviation recorded below | PASS with a recorded deviation |
| III | `CapabilityRegistry` gains an endpoint layer; `capabilityRegistryFor` scopes by `(provider, origin)`; a silently-unenforced tier is caught by validation, never trusted on its 200 | PASS |
| IV | No change to any guard. The frame inspector renders frame contents as text, fed by an observer that cannot alter rendering | PASS |
| V | `packages/core/package.json` still has no `dependencies`; no `node:` import in core or react (`grep` clean); profiles construct at module scope on any runtime | PASS |
| VI | This document, gated both ends; constitution amended in the same change with a Sync Impact Report | PASS |
| VII | 236 unit tests (156 → 236). 20 browser tests on two app instances. Every refusal in acceptance scenarios 3, 4 and 10 has a test asserting the refusal. Property test: no prefix of a document loses a member an earlier prefix had | PASS |

### Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| **Principle II** — the wire schema sent to a constrained decoder is a looser description than the application's schema ("MUST fail loudly … rather than emit an approximation that silently mis-describes the shape to the model") | Ollama 0.35 accepts a schema carrying `pattern` and then enforces nothing: 0 of 6 generations completed with the schema as authored, 6 of 6 with `pattern` omitted. The keyword comes from the SDK's own `displayText()` | **Fail loudly instead** (refuse the constrained tier for any schema with an unsupported keyword): the failure would be permanent, and would put every local generation on the tool tier, which Ollama delivers in one chunk — no streaming at all. **Detect and downgrade**: only possible after the bad tokens are generated and partly painted. The deviation is bounded: derived not maintained, removal only, never widens acceptance, and reported by a `schema_adapted` event every time |

Two judgement calls worth recording, since a reviewer will notice them:

- **`sovereign` is asserted, not verified.** An application-defined profile can
  claim it. The SDK refuses only the self-contradictory case (sovereign plus
  plaintext). The alternative — refusing `sovereign: true` on anything but the
  built-in — would stop a team with a genuine in-jurisdiction gateway from
  saying so. The claim has to be written in code, where review can see it.
- **An empty-handed tier downgrades without being remembered.** Remembering
  would be more consistent with how a rejection is handled, and would turn one
  blank response from a flaky small model into a permanently degraded endpoint.

---

## Verification

| Gate | Command | Result |
|---|---|---|
| Types | `pnpm typecheck` | clean |
| Unit tests | `pnpm test` | 236 passing, 13 files |
| Feature 001 regression | the 156 tests that existed before | all 156 passed untouched against the refactored client (T-118). Three assertions were changed afterwards, deliberately: partial numbers held rather than dropped (T-136), the example's provider fallback now a throw (T-145), the browser tier assertion (T-149). None concerns relaxAI behaviour |
| Build | `pnpm build` | ESM + CJS + types, 3 packages |
| Example types | `pnpm typecheck` in `examples/next-app` | clean |
| Browser | `pnpm test:e2e` | 20 passing — 14 `modern-runtime`, 6 `legacy-runtime` |
| Probe self-test | `pnpm probe:selftest` | passing (and now passing on Windows) |
| No `node:` in core | `grep -rn 'from "node:' packages/core/src packages/react/src` | no matches |
| Core has no runtime deps | `packages/core/package.json` → `dependencies` | absent |

### Against a real model

`pnpm frames`, Ollama 0.35.0, CPU, the reference app's `Dashboard` schema, one
generation each. "Invariants" are the five in [data-model.md §9](./data-model.md).

| Model | Tier | Frames | First paint | Finished | Invariants | Result |
|---|---|---|---|---|---|---|
| `qwen2.5:3b` | `native_json_schema` | 234 | 7.0 s | 37.6 s | held | validated |
| `llama3.2:3b` | `native_json_schema` | 185 | 0.2 s (warm) | 31.4 s | held | validated |
| `qwen2.5:7b` | `native_json_schema` | 147 | 119 s (cold load) | 172.6 s | held | validated |
| `llama3.2:1b` | `native_json_schema` | 282 | 5.4 s | 26.2 s | held | validated |
| `qwen3:4b` (reasoning) | `native_json_schema` | 220 | 64.6 s | 136.1 s | held | validated |
| auto-picked (`llama3.2:3b`) | `native_json_schema` | 174 | 9.2 s | 38.4 s | held | validated |
| `qwen2.5:3b`, forced | `prompted_json` | 233 | 43.0 s | 79.0 s | held | validated |
| `qwen2.5:3b`, 80 ms throttle | `native_json_schema` | 165 | 0.8 s (warm) | 88.3 s | held | validated |
| `qwen2.5:7b`, forced | `tool_call` | 0 | never | 218.5 s | held | **`no_content`** |

The last row is the tool tier doing on a 7b model what R4 recorded on a 3b: the
forced call came back empty, and with the strategy forced there is no tier to
move to, so the generation ends in a typed error after one re-ask. On the
default ladder that tier is never reached on Ollama, and where it is reached and
comes back empty the SDK now moves to `prompted_json` — which the row above it
shows working on the same runtime.

`pnpm probe -- --provider ollama` measured `jsonSchema: true` for `qwen2.5:7b`
and `llama3.2:3b` and reported that every measurement agreed with the profile's
prior. Three of its tool-calling probes exceeded the probe's own 60 s request
limit on CPU and were left unrecorded rather than guessed.

Schema dialect A/B, three seeds per cell (ADR-0008): adapted **6/6** complete;
as authored **0/6**.

Refusals, from the command line: unknown provider → `config_invalid` listing the
four built-ins; `ollama` at `http://10.0.0.5` → `sovereignty_violation`
(plaintext to a non-loopback host); `ollama` at `https://ollama.example.com` →
`sovereignty_violation` (host not allowlisted); runtime not listening →
one `error` frame, `transport_error`; embeddings model → one `error` frame,
`capability_unsupported`, no request sent; relaxAI with no key →
`config_invalid` naming `RELAX_API_KEY`.

---

## Known limitations

1. **Two built-in profiles are unmeasured.** `lmstudio` and `llamacpp` claim an
   address and a loopback policy. No capability refinement, no dialect. T-158.
2. **The Ollama dialect is pinned to one version.** Measured on 0.35.0. A later
   release may enforce `pattern`, at which point the dialect costs enforcement
   for nothing; `pnpm frames` is how to find out.
3. **A growing string is resent whole on every patch.** Measured: a
   304-character string cost 11.4 kB over 55 patches; the stream was 27.5 kB for
   a 953-byte document. NFR-008 of feature 001 holds per *document* and not per
   *string*. The fix is an `append` op and a protocol major. T-159.
4. **No idle timeout on an open stream.** `timeoutMs` bounds time to headers.
   T-160.
5. **Silent non-enforcement is fixed for one keyword.** Any other keyword a
   runtime quietly ignores is still caught only by validation, after the tokens
   are spent.
6. **Local first paint is dominated by model load.** 119 s for a cold 7b on CPU.
   Not the SDK's to fix, but it is what a first run looks like, and the example's
   README says so.
7. **relaxAI itself is still unmeasured.** Nothing in this feature changes that;
   T-056c stands. What this feature adds is that the *engine* has now been run
   against real models, which it had not been before.
