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
  **Superseded by the phase 2 rerun:** two measurement bugs found in phase 2
  undercounted the phone profile in particular. The corrected table is in the
  phase 2 notes; this one is kept as first published.

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

- [x] **T-410** Tests: the bench contract. It extends the standard twelve (they
  are unchanged and still pass their own suite); each heavy visual has a schema
  and a role; under `prefers-reduced-motion`, counters do not animate; contrast
  in every variant.
- [x] **T-411** Heatmap, Scatter, SparklineGrid and AnimatedCounter as kit
  templates, with styles from base-theme tokens only.
- [x] **T-412** Their ladders, for both of this SDK's renderers, on both
  profiles.

### Phase 2 notes

- **The kit** (`bench/src/kit`): the four heavy visuals as templates (markup as
  data), styled from base-theme tokens only. `<gen-ui>` takes them as a
  template connector with an adopted stylesheet, the route any host takes to
  add its own components; React takes them through `fromTemplates`. The
  reference drawing uses the same templates, so correctness covers them.
- **Counters animate with CSS only**: a roll-in when they appear and a
  pulsing live bar while on screen, declared only under
  `prefers-reduced-motion: no-preference`. The self-test checks it in the
  browser: 10 running animations normally, none under `reduce`. Chromium's
  `document.getAnimations()` leaves out shadow trees, so the check asks each
  shadow root.
- **Contrast is tested from the tokens**, in light and dark: text 4.5:1 on
  every background the kit draws; series colours, tones and the top heat level
  3:1 against the surface; heat levels step monotonically.
- **Two measurement bugs, found because the phone ladders stopped at their
  first step once the warm-up included the kit.** Both are fixed, both have a
  self-test case that fails without the fix, and every ladder was rerun.
  1. A long frame from the warm-up (lazy component code and the first style
     pass, about 200 ms at 4× CPU) is reported after its frame ends, which can
     be after the run's observer has started. Only frames that start in the
     run now count.
  2. The half-way click stretches its frame to about 57 ms on the phone
     profile, with nothing blocking it (blocking duration zero, no script, no
     rendering). A frame now counts as a long task only if something in it
     blocked.
- **Corrected results, every ladder** (`bench/results/local-2026-11-10.json`,
  same laptop and browser):

  | Ladder | Element, desktop | Element, phone (CPU 4×) | React, desktop | React, phone |
  |---|---|---|---|---|
  | Nodes, streamed | not reached (10,000) | 250 | 500 | 10 |
  | Nodes, one frame | 1,000 | 10 | 500 | below 10 |
  | Depth | 96, then the tab crashes | 48 | 96, then crash | below 2 |
  | Table cells | 10,000 | 100 | 25,000 | 20 |
  | Chart points | 1,000 | 50 | 250 | 8 |
  | Frame rate (500 nodes) | not reached (100/s) | 25/s | 25/s | below 5/s |
  | Text churn (500 nodes) | not reached (100%) | 1% | not reached (100%) | below 1% |
  | Tone density (1,000 nodes) | not reached | below 0% | below 0% | below 0% |
  | Heatmap cells | 10,000 | 100 | 10,000 | 100 |
  | Scatter points | 5,000 | 100 | 5,000 | 100 |
  | Sparklines (30 points each) | not reached (1,000) | 100 | not reached (1,000) | 25 |
  | Animated counters | 500 | 10 | 100 | 10 |
  | Cold start (first node; longest task) | 61 ms; none over 50 | 70 ms; 118 ms | 73 ms; none | 118 ms; 298 ms |

  "Below" means the first step already broke. Tone density holds 1,000 nodes,
  above where React and the phone profile break, so its zero there says no
  more than the nodes ladder does.
- **What the heavy visuals show.** On the desktop both renderers draw the same
  heavy visuals to the same size: a heatmap of 10,000 cells and a scatter of
  5,000 points are each one SVG node whose cost is the browser's, not the
  renderer's. Counters differ: with every value changing on every frame, the
  element holds 500 and React 100, where React's next step breaks on a long
  task. The hook's whole-document validation per frame (phase 1 finding 2) is
  the likely cost; not yet attributed.

## Phase 3 — Soak

- [x] **T-420** Tests: soak detection. A page that leaks one listener per frame
  fails; a page that leaks one detached node per document fails; a steady
  page passes.
- [x] **T-421** A 30-minute soak that keeps replacing and patching documents,
  sampling every minute; for `ours-element`, `ours-react`, and a framework
  connector (mounted components counted).

### Phase 3 notes

- **How it soaks** (`pnpm bench:soak`): five documents streamed into one
  mounted renderer, round and round, each patched frame by frame at 20 frames
  a second, then replaced by the next: a mixed document of 250 nodes, text
  churn, a growing table, counters changing every frame, a growing heatmap.
  Every minute the run pauses when document 0 is complete again, so each
  sample sees the same document; then garbage collection, heap, DOM nodes,
  listeners and mounted components. Detached DOM from a heap snapshot at the
  start and the end.
- **A third renderer for mounted components**: `ours-connect-react`, the
  element in light mode with Card and Metric as React components through
  `relax-ui-connect-react`, every mount and unmount counted. Soaked, not
  laddered: the connector's mount points change the markup.
- **Detection proved first.** Unit tests for the judgement, and three
  30-second soaks in the self-test: a steady page passes; a page that adds a
  window listener per document breaks on listeners; a page that keeps each
  replaced document breaks on detached DOM (and DOM nodes).
- **One measurement fix, found by that self-test.** Current Chromium's heap
  snapshot does not name nodes "Detached …"; it has a `detachedness` field,
  and DevTools draws the label from it. Counting by name found nothing. Both
  are now read; a unit test covers each format.
- **Results** (`bench/results/soak-2026-11-11.json`, same laptop, Chromium
  153, desktop profile, 30 minutes and 31 samples each): every renderer
  passes.

  | Renderer | Heap after GC, first → last | Heap growth (budget 10%) | DOM nodes | Listeners | Detached DOM | Mounted |
  |---|---|---|---|---|---|---|
  | Element | 2.71 → 2.83 MB | 2.2% | 981, flat | 13, flat | 0 → 0 | — |
  | React | 3.82 → 4.41 MB | 3.9% | 983, flat | 158, flat | 0 → 0 | — |
  | Element + React connector | 3.91 → 4.52 MB | 2.7% | 1,078, flat | 6,164, flat | 34 → 34 | 43 of 43 throughout |

  Heap rises over the first few minutes (code warming, caches filling) and is
  flat from about minute 20.
- **Finding for this SDK, recorded, not fixed here:** each React component
  mounted by the connector is its own React root, and React attaches its
  event listeners to every root's container: 6,164 listeners for 43 mounted
  components, about 140 each, against 13 for the element alone. Constant, so
  not a leak, but it is the cost of a framework connector per mounted node.
  Sharing one root through portals is the option to measure.

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

Phases 4 to 6 (T-430 onwards).
