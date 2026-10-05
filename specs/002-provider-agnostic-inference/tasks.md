# Tasks: Provider-Agnostic Inference

**Feature**: 002-provider-agnostic-inference
**Input**: [plan.md](./plan.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

`[P]` marks tasks with no dependency on each other that may run in parallel.
Per Constitution Principle VII, a test task precedes the implementation it covers
and must fail before that implementation exists. Where a task says *reproduced
first*, the failure was observed against the pre-change code before the fix was
written, and the observation is recorded.

Numbered from T-101 so they cannot be confused with feature 001's.

**Status legend**: `[x]` done · `[ ]` outstanding

---

## Phase A — Measure before designing

- [x] **T-101** Stand up the bench: Ollama 0.35.0, six local models. Record
  version, models and route in `research.md`.
- [x] **T-102** [P] Measure `response_format: json_schema` on the OpenAI route:
  honoured? streamed incrementally? (R2 — yes and yes.)
- [x] **T-103** [P] Measure the same with the reference app's real `Dashboard`
  schema. (R3 — accepted with a 200, **not enforced**.)
- [x] **T-104** Bisect T-103 by keyword family until one keyword is isolated.
  (R3 — `pattern`.)
- [x] **T-105** [P] Measure tool-call streaming across three models and both
  `tool_choice` forms. (R4 — one chunk, never incremental; sometimes empty.)
- [x] **T-106** [P] Measure reasoning control on the OpenAI route. (R5 — ignored;
  reasoning arrives as untagged content.)
- [x] **T-107** Survey `packages/core/src` for every coupling to relaxAI and
  classify each as configuration, policy, nominal type, shared state or wording
  (R1).

## Phase B — Governance (Principle VI)

- [x] **T-108** Amend the constitution to v1.1.0: Principle I gains the provider
  clauses, Principle III gains "(endpoint, model)" and "a 200 is not proof".
  Sync Impact Report updated; MINOR, with rationale.
- [x] **T-109** `spec.md` with eight clarifications resolved and no
  `[NEEDS CLARIFICATION]` markers.
- [x] **T-110** `research.md` (R1–R8), `data-model.md`, `contracts/provider-profile.md`,
  `quickstart.md`, `plan.md` with Constitution Check before and after design.

## Phase C — Provider layer (Principles I, III)

- [x] **T-111** Tests for `resolveProvider` / `defineProvider`: built-ins present,
  aliases, **unknown name throws and lists the valid ones**, bad id, relative
  base URL, sovereign-plus-plaintext refused, frozen result.
- [x] **T-112** Tests for the built-in profiles as data: exactly one is sovereign;
  every local one is loopback-only.
- [x] **T-113** `provider/profile.ts`: `ProviderProfile`, `SchemaDialect`,
  `ProviderDescriptor`, `LOOPBACK_ONLY_POLICY`, four built-ins.
- [x] **T-114** Tests for `OpenAICompatibleClient`: keyless construction; **no
  `Authorization` header** without a key; a supplied key still sent; remote host
  on a local profile refused over https *and* over plaintext; **an environment
  variable cannot widen the allowlist**; an explicit option can, and does not
  make the provider sovereign; errors name the provider, not relaxAI.
- [x] **T-115** `client/inference-client.ts` (the interface),
  `client/openai-compatible-client.ts`, `client/env.ts`; `RelaxClient` reduced to
  a subclass with the provider fixed. `HttpClient` takes an `upstream` label.
- [x] **T-116** Tests for `createClient`: default relaxAI; reads
  `RELAX_UI_PROVIDER`; explicit option wins; a misspelt value throws even with a
  relaxAI key present; `RelaxClient` ignores the variable entirely.
- [x] **T-117** `createClient`.
- [x] **T-118** Gate: feature 001's 156 tests pass with **no change to any of
  them** (FR-123). Held at this point, before any behaviour changed. T-136,
  T-145 and T-149 each later change one existing assertion on purpose.

## Phase D — Capability per endpoint (Principle III)

- [x] **T-119** Tests: a provider refines a chat model's prior; never makes an
  embeddings model chat-capable; an observation outranks the refinement; two
  clients of one endpoint share what is learned; a different endpoint serving
  the same model name does not; a local refinement does not leak into relaxAI's
  registry.
- [x] **T-120** `CapabilityRegistry` third layer (`endpointDefaults`) and
  `capabilityRegistryFor(scope)`.
- [x] **T-121** [P] Move model ranking from the example into core
  (`provider/model-selection.ts`), remove non-chat models rather than rank them
  last, add `discoverChatModel`. Tests against a real `ollama list`.

## Phase E — Wire schema (Principle II, with a recorded tension)

- [x] **T-122** Tests for `adaptJsonSchema`: removal at every schema position; **a
  property named `pattern` survives**; `const`/`enum`/`default` data untouched;
  input not mutated; identity when nothing is dropped; dropped keywords reported
  once, sorted; the validator still refuses what the dropped keyword described.
- [x] **T-123** `schema/dialect.ts`.
- [x] **T-124** Tests through the engine: an Ollama client's request carries no
  `pattern`; a relaxAI client's does; `schema_adapted` emitted for the first and
  not the second; tool parameters adapted too; the prompted tier gets the full
  schema; a value violating the dropped keyword still ends in `schema_violation`.
- [x] **T-125** `StrategyContext.wireSchema`; `resolveWireSchema` in `generate.ts`;
  `schema_adapted` trace event.
- [x] **T-126** Live A/B, three seeds per cell, two models: adapted 6/6 complete,
  as-authored 0/6. Recorded in ADR-0008.

## Phase F — Frame creation

Each defect below was **reproduced first** against the pre-change code.

- [x] **T-127** *Reproduced*: an embeddings model and a missing prompt both reach
  the wire as `transport_error`, with no `[DONE]`. Tests: single `error` frame,
  own code, request id, body terminated.
- [x] **T-128** `streamObject` wraps the tier loop so nothing escapes as a throw;
  `toSSEStream` always terminates with `[DONE]`.
- [x] **T-129** *Reproduced*: an empty forced tool call ends in `no_content` after
  re-asking the same tier. Tests: downgrade to the next tier; `meta` names the
  tier that produced the document; **not remembered**; typed error when no tier
  is left; `truncated` — not a downgrade — when the budget ran out first; same
  on the batch path.
- [x] **T-130** Empty-handed downgrade in both `streamObject` and
  `generateObject`; `meta` written lazily with the first document frame;
  `engaged` separated from `announced`.
- [x] **T-131** Tests: a forced tool call answered as message text is parsed
  without a second request; the tool channel wins when a model uses both.
- [x] **T-132** `StructuringStrategy.fallbackDeltaOf`; second accumulator in
  `streamObject`.
- [x] **T-133** Tests: `meta` and completion metadata carry the provider id;
  batch-fallback `meta` names the strategy it ended on; `streamObject` emits
  `strategy_selected` / `strategy_downgraded` / `validated`.
- [x] **T-134** `provider` on `UIStreamMetaEvent` and `GenerationMetadata`; trace
  events from the streaming path.
- [x] **T-135** Tests: an `InferenceClient` written as a plain object — no SDK
  class, no HTTP — drives `streamObject` and `generateObject`; one that omits
  `provider` still streams.
- [x] **T-136** *Found in the frame inspector, then reproduced offline*: `remove`
  ops in mid-stream. `12` → `12.` → `12.5` parsed as present → absent → present.
  Tests: number held at its longest valid prefix; **property test that no prefix
  of a document loses a member an earlier prefix had**, compact and
  pretty-printed.
- [x] **T-137** `validNumberPrefix` in `stream/partial-json.ts`.
- [x] **T-138** *Found when a benchmark script would not exit, then reproduced*:
  stopping early released the reader's lock but never cancelled the response
  body, so the model went on generating. Tests with a body that never ends on
  its own: cancelled on consumer `break`; cancelled on a mid-stream schema
  violation; cancelled when the UI stream's consumer goes away.
- [x] **T-139** `decodeSSE` cancels an undrained body in `finally`;
  `toSSEStream.cancel` awaits the generator's shutdown.

## Phase G — Adapters

- [x] **T-140** [P] `relax-ui-next`: `client: InferenceClient`; `timeoutMs`
  defaults to the client's own rather than a hard-coded 120 000.
- [x] **T-141** [P] `relax-ui-react`: `onFrame` observer; `provider` in hook state.

## Phase H — Tooling (FR-118, FR-119)

- [x] **T-142** `scripts/inspect-frames.ts` + `pnpm frames`: one generation,
  every frame printed, five invariants asserted, non-zero exit on any breach.
- [x] **T-143** [P] `scripts/probe-models.ts --provider`. `RelaxClient` is still
  used when no provider is named, so the default run cannot be redirected by a
  stray environment variable.
- [x] **T-144** [P] `scripts/probe-selftest.mjs`: fix script paths on Windows
  (`URL.pathname` → `fileURLToPath`). Pre-existing; it had only ever run on Linux
  CI.

## Phase I — Reference application

- [x] **T-145** `app/provider.ts` rebuilt on the SDK's profiles: no hand-written
  loopback policy, no placeholder key, **no fallback on an unknown provider**.
  `RELAX_UI_MODEL` for any provider.
- [x] **T-146** `app/frame-inspector.tsx`: one row per frame, fed by `onFrame`;
  `?frames=1` opens it on load.
- [x] **T-147** Banner states provider, locality and non-sovereignty; footer
  names the provider.
- [x] **T-148** Stand-in endpoint: `SCHEMA` fixed per process, `MODE=emptytool`,
  `DELAY_MS`, `/__last` reporting request facts (never the prompt).
- [x] **T-149** Browser tests split into two projects on two app instances from
  one build — `modern-runtime` and `legacy-runtime` — because the SDK remembers
  a refusal for the life of the process. 20 tests.
- [x] **T-150** `demo/record.spec.ts` + `playwright.demo.config.ts` +
  `pnpm demo:record`. Video and still written to `docs/demo/`.

## Phase J — Verification against a real model (NFR-104)

- [x] **T-151** `pnpm frames` against five local models on the default ladder:
  all complete, all invariants held.
- [x] **T-152** Forced `tool_call` and forced `prompted_json` against a local
  model.
- [x] **T-153** Refusal paths from the command line: unknown provider, remote
  host (https and plaintext), runtime not running, embeddings model, relaxAI
  without a key, LM Studio not running.
- [x] **T-154** Record the demo against a real local model.
- [x] **T-161** Measure whether a constrained tier should also show the model its
  schema (R9), prompted by one recorded generation that put a sentence in
  `Metric.value`. Two seeds per variant: hidden, correct both times; shown, the
  model copied the description's example into every metric and took 1.5–2× as
  long. **Rejected**; no code change. Advice for registry authors added to
  troubleshooting.

## Phase K — Documentation

- [x] **T-155** [P] ADR-0007 (provider profiles and the inference interface) and
  ADR-0008 (wire-schema dialects), each with its mandatory "bad" section.
- [x] **T-156** [P] `ui-stream-protocol.md`: optional `provider`; lazy `meta`;
  the lone-`error` stream; `[DONE]` always.
- [x] **T-157** [P] README, example README, API reference, security model, HLD
  seams and risks, troubleshooting (six new symptoms), `.env.example` ×2.

---

## Outstanding

- [ ] **T-158** Measure `lmstudio` and `llamacpp`. Their profiles claim an
  address and a loopback policy and nothing else, and say so in `note`. Neither
  runtime was on the bench. `pnpm frames -- --provider lmstudio` and
  `pnpm probe -- --provider lmstudio` are the two commands.
- [ ] **T-159** A string-append patch op. A growing string is sent as a
  `replace` carrying the whole value so far, which is quadratic in the length of
  that one string. Measured on the bench: a 304-character `Prose` text arrived as
  55 patches totalling 11.4 kB, and the whole stream was 27.5 kB for a 953-byte
  document. An `append` op fixes it and is a **protocol major**, since a client
  that does not understand it cannot render — so it is recorded here rather
  than slipped into an additive change.
- [ ] **T-160** An idle timeout for a stalled upstream stream. `timeoutMs` bounds
  time-to-headers; once the body is open, a model that stops emitting holds the
  request until the caller's own signal fires.
- [ ] **T-056c** (feature 001, unchanged) Measure relaxAI's priors against the
  live API. `pnpm probe` — and now `pnpm frames -- --provider relaxai` — need a
  key and network access this environment does not have.

---

## Dependency order

```
A ─► B ─► C ─► D ─┬─► F ─► G ─► I ─► J ─► K
                  └─► E ─┘       └─► H ─┘
```

A precedes B deliberately. The spec's clarifications on capability, silent
non-enforcement and single-chunk tool calls are *answers*, and they could only
be answered by measuring.

## Parallel batches actually used

- **T-102, T-103, T-105, T-106** — independent measurements
- **T-140, T-141** — the two adapter packages
- **T-143, T-144** — the two probe scripts
- **T-155, T-156, T-157** — documentation

## Verification gate

`pnpm verify` · `pnpm test:e2e` · `pnpm probe:selftest` · `pnpm frames` against a
local model. Results in [plan.md](./plan.md#verification).
