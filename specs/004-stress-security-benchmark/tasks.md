# Tasks: Stress, Soak and Security Benchmark

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Tests before implementation. `[P]` marks tasks that can run in parallel. Each
phase is releasable on its own (plan, phase 3).

---

## Phase 1 — Harness, and this SDK's ladders

- [x] **T-401** `bench/` private package outside `packages/`. CI check: no
  published package depends on it, and the release build ignores it.
- [x] **T-402** Tests: the seeded generator. The same seed gives identical
  documents and frames; frames grow monotonically (F1); the last frame equals
  the document (F2); steps above 500 nodes or depth 24 use the bench contract
  (W2).
- [x] **T-403** Generator and ladders for nodes, depth, table cells, chart points,
  frames per second, text churn and tone density (research R4).
- [x] **T-404** Tests: the probe and the runner, against fake pages.
  - a page that blocks the main thread 80 ms breaks on `longestTask`;
  - a page that drops a node breaks on correctness;
  - a page that never finishes breaks on timeout;
  - a steady page passes every budget.
- [x] **T-405** In-page probe (frames, long animation frames, event timing,
  scheduler) and the runner. The runner covers Playwright, the DevTools Protocol
  (heap after garbage collection, DOM counters, CPU slowdown), both profiles,
  five repetitions after a warm-up, ladder stop, and the result writer.
- [x] **T-406** Budgets file mirrored from `contracts/budgets.md`; the result
  schema from `contracts/results.md`, with a validator.
- [x] **T-407** Adapters `ours-element` and `ours-react`; full ladders on both
  profiles; first results committed.
- [x] **T-408** `pnpm bench:selftest`: a deliberately slowed renderer, a
  deliberately wrong one, and a correct one. The harness must classify all
  three correctly.

### Phase 1 notes

- **The harness proves itself first.** `pnpm bench:selftest` classifies four
  renderers before any result is kept:
  - an untouched one passes;
  - one that blocks 80 ms per frame breaks on the long task;
  - one that drops a node breaks on correctness;
  - a hung one breaks on the timeout.

  It runs in CI.
- **Four methodology corrections, made before any result was kept** (research
  R2):
  - frame budget v2: 25 ms. An idle page measures 16.8 ms at the 95th
    percentile, so 16.7 ms could not be met;
  - a one-second minimum sampling window;
  - cold start separated from scaling (a warm-up document, then `next()` into
    the same mounted renderer);
  - smaller first steps, so the phone profile has steps to pass.
- **Two generator bugs found by running it.**
  - Churned text overflowed the Badge limit. The React hook rightly stopped
    the stream; the generator test now validates every frame.
  - The churn ladder first delivered a whole document in one frame.
- **First results** (`bench/results/local-2026-11-10.json`). Laptop: Intel
  i7-1165G7, 16 GB, Windows, Chromium 153. Budget v2, five repetitions, medians.

  | Ladder | Element, desktop | Element, phone (CPU 4×) | React, desktop | React, phone |
  |---|---|---|---|---|
  | Nodes, streamed | not reached (10,000) | 250 | 500 | below 10 |
  | Nodes, one frame | 1,000 | 10 | 500 | below 10 |
  | Depth | 96, then the tab crashes | 24 | 96, then crash | below 2 |
  | Table cells | 10,000 | 100 | 25,000 | below 20 |
  | Chart points | 1,000 | 8 | 250 | below 8 |
  | Frame rate (500 nodes) | not reached (100/s) | 5/s | 25/s | below 5/s |
  | Text churn (500 nodes) | not reached (100%) | below 1% | 50% | below 1% |
  | Tone density (1,000 nodes) | not reached | below 0% | below 0% | below 0% |
  | Cold start (first node; longest task) | 68 ms; none over 50 | 66 ms; 94 ms | 70 ms; none | 84 ms; 84 ms |

- **Findings for this SDK**, recorded for later phases, not fixed here:
  1. **On the phone profile, style and layout dominate.** A fresh element's
     first style pass costs about 90 ms at 4× CPU, and a 500-node static
     document's frame spends 273 ms of 394 ms in style and layout
     (long-animation-frame attribution). The base theme's CSS is the first
     optimisation target for phones.
  2. **The React hook validates the whole document on every frame** against
     the schema; the element validates only nodes that changed. At 500 nodes
     and 5 frames per second on the phone profile, that is 34 long tasks of
     about 200 ms per run. Incremental validation in `relax-ui-react` is the
     second target.
  3. **Chromium's tab crashes past roughly 130–190 nested elements**, by
     layout type, with or without this SDK (research R2). The standard
     contract's depth budget (24) keeps documents two to three times below
     it, in both validation tiers.


## Phase 2 — Heavy visuals

- [ ] **T-410** Tests: the bench contract. It extends the standard twelve (they
  are unchanged and still pass their own suite); each heavy visual has a schema
  and a role; under `prefers-reduced-motion`, counters do not animate; contrast
  in every variant.
- [ ] **T-411** Heatmap, Scatter, SparklineGrid and AnimatedCounter as kit
  templates, with styles from base-theme tokens only.
- [ ] **T-412** Their ladders, for both of this SDK's renderers, on both
  profiles.

## Phase 3 — Soak

- [ ] **T-420** Tests: soak detection. A page that leaks one listener per frame
  fails; a page that leaks one detached node per document fails; a steady
  page passes.
- [ ] **T-421** A 30-minute soak that keeps replacing and patching documents,
  sampling every minute; for `ours-element`, `ours-react`, and a framework
  connector (mounted components counted).

## Phase 4 — Comparison

- [ ] **T-430** Kit drawers for React, Lit and Angular. Test: each draws every
  template to the same markup as the DOM renderer.
- [ ] **T-431** [P] `json-render` adapter (JSONL patches, registry of kit
  components).
- [ ] **T-432** [P] `a2ui-lit`, `a2ui-react` and `a2ui-angular` adapters
  (v0.9 messages, a custom catalog of kit components).
- [ ] **T-433** [P] `openui` adapter (OpenUI Lang encoding, library of kit
  components).
- [ ] **T-434** [P] `ai-sdk` adapter (partial JSON through `useObject`,
  hand-written kit components).
- [ ] **T-435** [P] `ours-vue-host` and `ours-angular-host` adapters.
- [ ] **T-436** Structural gate: every adapter's markup equals the reference
  for every workload, or it is reported as not expressible with a reason.
- [ ] **T-437** Full comparison on both profiles; results committed.

## Phase 5 — Attacks

- [ ] **T-440** Tests: the classifier.
  - a deliberately unsafe renderer is "executed" by every evidence kind:
    canary, policy violation, forbidden DOM, external request, global change,
    bounds escape;
  - a safe one is "blocked" or "inert".
- [ ] **T-441** The injection corpus (`contracts/attacks.md`) and a seeded
  fuzzer, placed in every prop, connector, tier and host.
- [ ] **T-442** The protocol and denial-of-service cases, each with its required
  outcome.
- [ ] **T-443** The injection tricks: prototype keys, CSS-shaped values, `style`
  and identity attributes through props, overlays, policy bypass.
- [ ] **T-444** The red-team: about twenty prompts × five runs × two local
  models, through the real route; attempt and leak rates.
- [ ] **T-445** The corpus against every contender, with the disclosure gate
  (FR-435).
- [ ] **T-446** Fix every finding in this SDK, each with a test that fails
  without the fix.

## Phase 6 — Running and showing

- [ ] **T-450** CI job "Bench smoke": short ladders against the stored `main`
  result within tolerance, plus the attack suites; under 10 minutes. Test: a
  deliberate 50% slowdown fails it; noise does not, over ten runs.
- [ ] **T-451** Nightly workflow: everything, both profiles, results uploaded
  and committed by a bot pull request.
- [ ] **T-452** The dashboard: a static page built from the results. It shows
  break points, ladder curves, desktop against phone, soak trends and attack
  outcomes, and each figure links to its workload and its reproduce command.
- [ ] **T-453** README and `docs/comparison.md` summary tables; the plan's
  Verification filled in.

---

## Dependency order

```
1 ─► 2 ─► 4 ─► 6
│    └─► 3 ──┘
└─► 5 (needs 1; contenders part needs 4)
```

## Outstanding

Phases 2 to 6 (T-410 onwards).
