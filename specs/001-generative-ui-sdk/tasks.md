# Tasks: Generative UI SDK for relaxAI

**Feature**: 001-generative-ui-sdk
**Input**: [plan.md](./plan.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

`[P]` marks tasks with no dependency on each other that may run in parallel.
Per Constitution Principle VII, a test task precedes the implementation it covers
and must fail before that implementation exists.

**Status legend**: `[x]` done · `[ ]` outstanding

---

## Phase A — Foundation

- [x] **T-001** pnpm workspace root: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.gitignore`
- [x] **T-002** Root `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, path aliases for the three packages
- [x] **T-003** `vitest.config.ts` resolving workspace aliases to source, so tests exercise source not `dist`
- [x] **T-004** [P] `packages/core` manifest + `tsup.config.ts`; zero `dependencies`, Zod as peer
- [x] **T-005** [P] `packages/react` manifest + tsup with a `"use client"` banner
- [x] **T-006** [P] `packages/next` manifest + tsup; `next` external, never a runtime import
- [x] **T-007** Allow esbuild's postinstall in `pnpm-workspace.yaml` (pnpm 10 blocks build scripts by default)

## Phase B — Core types and errors

- [x] **T-008** `core/src/types.ts`: OpenAI-compatible wire types, `STRATEGY_PRECEDENCE`, `GenerationMetadata`. No Zod import — the protocol must be describable without a validator.
- [x] **T-009** `core/src/errors.ts`: `RelaxUIError` with the stable `code` set, `retryable`, and a `toJSON()` that cannot leak prompt text

## Phase C — Guards (Principle I, IV)

- [x] **T-010** Tests for `assertSovereignEndpoint`: allowlist, wildcard suffix, `http` refusal, loopback opt-in, opt-in must not unlock a remote host
- [x] **T-011** `guard/sovereignty.ts`
- [x] **T-012** [P] Tests for `sanitizeUrl`: `javascript:`, control-character obfuscation, `data:` media types, host allowlist, relative paths
- [x] **T-013** [P] `guard/url.ts`
- [x] **T-014** [P] Tests for `redact`: email/PAN/NINO/IBAN/secret; prose untouched; no regex `lastIndex` leakage between calls
- [x] **T-015** [P] `guard/redaction.ts`

## Phase D — Schema layer (Principle II)

- [x] **T-016** `schema/zod-introspect.ts`: normalise Zod 3 vs 4 internals behind one module
- [x] **T-017** Tests for `toJsonSchema`: required/optional, strict mode, constraints, unions + discriminator, recursion via `$defs`/`$ref`, explicit throw on unrepresentable constructs
- [x] **T-018** `schema/json-schema.ts`
- [x] **T-019** `schema/partial.ts`: issue classification (`pending` vs `fatal`), `safeParsePartial`, `formatIssues`, `redactIssues`
- [x] **T-020** `schema/define.ts`: `defineStructuredSchema` with name validation and a JSON Schema override

## Phase E — Streaming primitives

- [x] **T-021** Tests for `completePartialJson` / `parsePartialJson`: value-string kept, key discarded, dangling separators rewound, incomplete literals and numbers, escape and `\uXXXX` trimming, structural rejection, **and every prefix of a realistic document**
- [x] **T-022** `stream/partial-json.ts`
- [x] **T-023** [P] Tests for `diffJson` / `applyPatch`: pointer escaping, array append/truncate, nested descent, structural sharing, full streaming round-trip
- [x] **T-024** [P] `stream/json-patch.ts`
- [x] **T-025** [P] `stream/sse.ts`: `ReadableStream`-based decoder, CRLF, split frames, comments, `[DONE]`

## Phase F — Capability negotiation (Principle III)

- [x] **T-026** `capability/registry.ts`: family-pattern table with provenance notes, conservative unknown default, mutable overrides
- [x] **T-027** `capability/negotiate.ts`: ladder construction, `force`/`allow`, `isCapabilityRejection`

## Phase G — Strategies

- [x] **T-028** `strategy/extract.ts`: reasoning-wrapper stripping (empty string while a block is open), fence stripping, chatter trimming, `JsonTextAccumulator`
- [x] **T-029** `strategy/index.ts`: the three strategies, each owning its own request builder *and* its own response reader

## Phase H — Transport

- [x] **T-030** `client/http.ts`: `fetch`-only, full-jitter backoff, `Retry-After`, timeout vs abort distinction, injectable `sleep`/`random`
- [x] **T-031** `client/relax-client.ts`: sovereignty check in the constructor, redaction immediately before serialisation, SSE chunk decoding that skips non-JSON frames

## Phase I — Orchestration

- [x] **T-032** `protocol.ts`: event union, SSE encoding, `UIStreamAccumulator` with strict `seq` ordering
- [x] **T-033** Tests for `generateObject`: each tier, downgrade + persistence, reasoning/fence stripping, repair round-trip, unrepairable → typed error, embeddings model rejected before a request, full ladder walk, no downgrade on a 401
- [x] **T-034** `generate.ts::generateObject`
- [x] **T-035** Tests for `streamObject`: ordered frames, tool-call deltas, fatal-violation abort, pending issues tolerated, non-streaming fallback, off-stream repair, in-band error frame, throttle coalescing
- [x] **T-036** `generate.ts::streamObject` + `toSSEStream`

## Phase J — Generative UI contract (Principle IV)

- [x] **T-037** Tests for `createUIRegistry`: unknown component rejected, bad props rejected, extra props rejected, `javascript:` URL rejected at validation, control characters rejected, node and depth budgets, children policies, `$ref` in the derived schema
- [x] **T-038** `ui/contract.ts`: recursive discriminated union, `urlString`, `displayText`, iterative `measureTree`
- [x] **T-039** `observability/metrics.ts`: in-process counters, no transport
- [x] **T-040** `core/src/index.ts` barrel

## Phase K — React

- [x] **T-041** Tests for `readUIStream`: split frames, CRLF, comments, non-JSON frames, non-event JSON, terminator, accumulator round-trip, out-of-order refusal
- [x] **T-042** `react/src/stream.ts`, `use-generative-object.ts`
- [x] **T-043** Tests for `GenerativeUI` via `react-dom/server`: unknown type, bad props, text escaping, `javascript:` href, depth limit, keying, schema defaults
- [x] **T-044** `react/src/renderer.tsx` + barrel

## Phase L — Next.js adapter

- [x] **T-045a** Tests for the route handlers: SSE headers, input rejection without an upstream call, smuggled `model`/`system` ignored, `authorize` short-circuit, system prompt precedence, in-band error frame, status mapping (429, 502)
- [x] **T-045b** `next/src/route.ts` + barrel

## Phase M — Reference application

- [x] **T-046a** `examples/next-app`: registry, Edge route, component implementations, streaming page
- [x] **T-046b** Verify with a real `next build`

## Phase M2 — Local-provider demo mode

- [x] **T-059** `model` in the Next adapter accepts a resolver, so a route can
  pick a model per request instead of at module scope. Two tests, incl. a
  resolver failure surfacing as a server error rather than a 400.
- [x] **T-060** `examples/next-app/app/provider.ts` — `RELAX_UI_PROVIDER` selects
  relaxAI (default) or local Ollama. Local mode gets a loopback-only sovereignty
  policy and auto-discovers the model from `/v1/models`.
- [x] **T-061** The page states the endpoint, and says plainly when it is not a
  sovereign one. `describeProvider()` reads env without constructing a client, so
  the banner renders with no API key present.
- [x] **T-062** Capability priors for locally-served families (Ollama-style tags
  `qwen2.5:7b`, `llama3.2:3b`, `gemma2:9b`) plus `embed|rerank` detection so a
  local `/models` listing's embedding models are correctly marked non-chat.
- [x] **T-063** Verified end to end: `next build` with no relaxAI key at all, then
  a live request through the running app against a stand-in endpoint — model
  auto-discovered, ladder starting at `tool_call`, valid document streamed.

## Phase N — Documentation

- [x] **T-047** [P] `docs/hld.md` — context, containers, request lifecycle, quality attributes
- [x] **T-048** [P] `docs/lld.md` — module-by-module internals, algorithms, complexity
- [x] **T-049** [P] `docs/diagrams/` — Mermaid: context, containers, sequences, state, threat model
- [x] **T-050** [P] `docs/adr/0001..0006` — the six load-bearing decisions with rejected alternatives
- [x] **T-051** [P] `docs/security-model.md` — threat model, controls, residual risk
- [x] **T-052** [P] `docs/api-reference.md`, `docs/troubleshooting.md`
- [x] **T-053** [P] Root `README.md` and a `README.md` per package
- [x] **T-054** [P] `.specify/templates/{spec,plan,tasks}-template.md` for subsequent features

## Phase O — CI

- [x] **T-055** `.github/workflows/ci.yml`: typecheck, test, build, plus the constitutional greps (no `node:` in core, no `dangerouslySetInnerHTML`, core has no runtime deps)

---

## Outstanding

- [x] **T-056a** `scripts/probe-models.ts` — probes each catalogue model for
  `json_schema`, tool calling, `json_object`, streaming and reasoning traces,
  reports where measurement disagrees with the shipped prior, and emits a
  paste-ready `CapabilityRegistry` seed. Drives the SDK's own `RelaxClient`, so a
  run also exercises the transport and the rejection classifier.
- [x] **T-056b** `scripts/stub-relax.mjs` + `scripts/probe-selftest.mjs` — four
  stub models with deliberately awkward behaviour, and assertions on the probe's
  conclusions about each. Runs in CI. It caught two real bugs on first execution:
  a streaming rejection recorded as an error rather than a capability fact, and a
  model failing every probe as "not a chat model" still being written back as
  `chatCapable: true`.
- [ ] **T-056c** Run the probe against a live key and replace the priors in
  `capability/registry.ts` with measurements. **Blocked here, not blocked for
  you**: this build environment's egress policy denies `relax.ai`, so it needs to
  be run somewhere with network access — `pnpm build && RELAX_API_KEY=... pnpm
  probe`. Until then every capability claim in `capability/registry.ts` is
  sourced from Civo's published documentation and carries a `note` saying so. The
  architecture absorbs a wrong prior (one wasted request per model per process),
  but this should land before a 1.0 publish.
- [ ] **T-057** Publish workflow (`changesets` + npm provenance). Deliberately
  deferred: nothing should be published until T-056 has run.
- [ ] **T-058** Browser-level integration test of the reference app
  (Playwright: submit, observe frames arrive, assert a rejected node renders
  nothing). The renderer's refusal paths are unit-tested; this would cover the
  wiring end to end.

---

## Dependency order

```
A ─► B ─► C ─┬─► D ─► E ─► F ─► G ─► H ─► I ─► J ─┬─► K ─► L ─► M
             └───────────── (C, D, E parallel) ───┘
                                                   └─► N, O (parallel with M)
```

## Parallel batches actually used

- **T-004, T-005, T-006** — three package manifests
- **T-010..T-015** — the three guards, independent of each other
- **T-023, T-024, T-025** — patch and SSE, independent of the partial parser
- **T-047..T-054** — all documentation

## Verification gate

```bash
pnpm verify                       # typecheck + 128 tests + build
cd examples/next-app && next build
grep -rn 'from "node:' packages/core/src          # must be empty
grep -rn 'dangerouslySetInnerHTML' packages       # must be empty
```
