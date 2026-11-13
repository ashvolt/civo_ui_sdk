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

- [x] **T-430** Kit drawers for React, Lit and Angular. Test: each draws every
  template to the same markup as the DOM renderer.
- [x] **T-431** [P] `json-render` adapter (JSONL patches, registry of kit
  components).
- [x] **T-432** [P] `a2ui-lit`, `a2ui-react` and `a2ui-angular` adapters
  (v0.9 messages, a custom catalog of kit components).
- [x] **T-433** [P] `openui` adapter (OpenUI Lang encoding, library of kit
  components).
- [x] **T-434** [P] `ai-sdk` adapter (partial JSON through `useObject`,
  hand-written kit components).
- [x] **T-435** [P] `ours-vue-host` and `ours-angular-host` adapters.
- [x] **T-436** Structural gate: every adapter's markup equals the reference
  for every workload, or it is reported as not expressible with a reason.
- [x] **T-437** Full comparison on both profiles; results committed.

### Phase 4 notes (part a: the React contenders)

Done in this part: the React kit drawer (T-430's React third), json-render,
OpenUI Lang and the AI SDK (T-431, T-433, T-434), the structural gate
(T-436), and the comparison of those three with this SDK's element and React
hook (T-437's first half). Left for part b: A2UI on Lit, React and Angular
(T-432), the Lit and Angular kit drawers, and the Vue and Angular hosts
(T-435).

- **One drawer for every React contender** (`bench/src/kit/react.ts`): the
  kit's templates, turned into React elements, nothing added. Each contender
  hands its own props to it from its own component registry. No URL guard and
  no attribute filter: what safety a page has is the contender's.
- **Each contender reads a byte stream through its own entry point**:
  json-render through `useUIStream` and a fetch that answers with the stream;
  OpenUI by giving `<Renderer>` the response text as it grows; the AI SDK
  through `useObject` with a custom fetch. Encodings, and how each is tested
  with the contender's own decoder, are in research R3.
- **The gate** (`pnpm bench:gate`): the document with every component, then
  the first two steps of each ladder, after a warm-up document, for each
  renderer. 121 cases draw the reference's markup and 4 are not expressible
  (the AI SDK's text churn and counters: a partial-JSON stream only appends).
- **Three corrections and a fix**, each in research R2 with its evidence:
  - this SDK's stream had two more deliveries than any contender's (`meta`
    and `complete` as chunks of their own); now one per frame, as everyone;
  - the gate now replaces a document, as the ladders do: the AI SDK page
    passed it and errored on every ladder step;
  - frame percentiles move in whole refreshes, so break points one step
    apart are treated as equal;
  - **fixed in this SDK**: the contract's recursive node schema rebuilt every
    component's schema on each node parse. The React hook gained up to two
    ladder steps on desktop and passes three ladders it failed before.
- **Results** (`bench/results/compare-2026-11-11.json`, same laptop,
  Chromium 153, five repetitions per step). Highest step passed; "all" is
  every step, "none" is not even the first, "n/e" not expressible.

  Desktop:

  | Workload | Ours, element | Ours, React | json-render | OpenUI | AI SDK |
  |---|---|---|---|---|---|
  | nodes (streamed) | all (10k) | 5,000 | 1,000 | 5,000 | 5,000 |
  | static nodes | all (10k) | 2,500 | 500 | 1,000 | 5,000 |
  | depth | 96 | 96 | 96 | 96 | 96 |
  | table cells | 10,000 | 25,000 | 10,000 | 10,000 | 25,000 |
  | chart points | 1,000 | 1,000 | 250 | 1,000 | 1,000 |
  | frame rate | all | all | all | all | all |
  | text churn | all | all | all | all | n/e |
  | tone density | all | all | all | all | all |
  | heatmap cells | 10,000 | 10,000 | 10,000 | 10,000 | 10,000 |
  | scatter points | 5,000 | 5,000 | 5,000 | 5,000 | 10,000 |
  | sparklines | all | all | all | all | all |
  | counters | 500 | 200 | 200 | 200 | n/e |

  Phone (4x CPU):

  | Workload | Ours, element | Ours, React | json-render | OpenUI | AI SDK |
  |---|---|---|---|---|---|
  | nodes (streamed) | 250 | 100 | 100 | 100 | 100 |
  | static nodes | 500 | 500 | 25 | none | 50 |
  | depth | 48 | 4 | 4 | none | none |
  | table cells | 100 | 100 | 100 | 100 | 100 |
  | chart points | 50 | 50 | 8 | 250 | 250 |
  | frame rate | none | none | 10 | none | none |
  | text churn | 1 | none | none | none | n/e |
  | tone density | none | none | none | none | none |
  | heatmap cells | 1,000 | 1,000 | 1,000 | 100 | 100 |
  | scatter points | 100 | 100 | 100 | 100 | 100 |
  | sparklines | 100 | 100 | 100 | 25 | 25 |
  | counters | 10 | 10 | 10 | 10 | n/e |

  Cold start (median, ms; first node / complete / longest task):

  | | Ours, element | Ours, React | json-render | OpenUI | AI SDK |
  |---|---|---|---|---|---|
  | desktop | 7 / 56 / 0 | 8 / 54 / 0 | 17 / 84 / 0 | 14 / 82 / 0 | 8 / 91 / 0 |
  | phone | 23 / 184 / 166 | 20 / 173 / 126 | 62 / 257 / 209 | 115 / 178 / 193 | 35 / 259 / 167 |

- **Reading it.** Differences of one step are noise (research R2). Beyond
  that: the element leads on streamed and static node counts on both
  profiles, and on depth on the phone; the AI SDK, which validates nothing
  while streaming, leads on table cells and scatter points on desktop;
  OpenUI and the AI SDK lead on chart points on the phone; every renderer
  breaks at the first step of tone density, and nearly all of frame rate, on
  the phone, which points at the shared base theme, not a renderer (the
  phone-theme follow-up). Validation is not equal: this SDK validates every
  frame against the full contract; the contender pages declare permissive
  prop schemas (the kit's props are not declared again for each), so
  json-render and OpenUI check structure only, and the AI SDK nothing.
- This SDK's rows supersede `local-2026-11-10.json`, which predates the
  schema fix and the equal deliveries.

### Phase 4 notes (part b: A2UI, and the Vue and Angular hosts)

Done in this part: the Lit and Angular kit drawers (the rest of T-430), A2UI
on Lit, React and Angular (T-432), this SDK's element inside a Vue and an
Angular app (T-435), and their comparison (the rest of T-437). How each was
built is in research R3.

- **A2UI's wire format**: `createSurface`, then one `updateComponents` per
  frame with the components that are new or changed, decoded in the tests by
  A2UI's own `MessageProcessor`. A component has no partial update, so an
  array growing inside one node is that node sent whole each frame.
- **The hosts A2UI puts around each component** are its DOM: the timings keep
  them, and the comparison reads through them (`unwrap` on the page adapter).
  Two changes to the canonical markup made the gate stricter: a run of text is
  one text whatever comments sit in it, and an SVG element must be one
  (`svg:rect`), so one made in the HTML namespace, which draws nothing, fails.
- **Angular** is compiled ahead of time by the Angular CLI and runs zoneless,
  as a production app does. `@a2ui/angular` 0.14.0 needs Angular 21, so the
  bench pins 21.2.5 for both Angular pages (research R11).
- **The gate**: 246 cases draw the reference's markup and 4 are not
  expressible, over the ten renderers.
- **Results**, merged into `bench/results/compare-2026-11-11.json` (same
  laptop, Chromium 153, five repetitions per step, on mains power).

  Desktop:

  | Workload | Ours, element | Ours, in Vue | Ours, in Angular | A2UI Lit | A2UI React | A2UI Angular |
  |---|---|---|---|---|---|---|
  | nodes (streamed) | all (10k) | all | all | 5,000 | 5,000 | 1,000 |
  | static nodes | all (10k) | 500 | 1,000 | 5,000 | 250 | 100 |
  | depth | 96 | 96 | 48 | 48 | 96 | 48 |
  | table cells | 10,000 | 10,000 | 10,000 | 10,000 | 10,000 | 5,000 |
  | chart points | 1,000 | 1,000 | 1,000 | 1,000 | 250 | 1,000 |
  | frame rate | all | all | all | all | all | all |
  | text churn | all | all | all | all | all | all |
  | tone density | all | all | all | all | all | all |
  | heatmap cells | 10,000 | 10,000 | 10,000 | 10,000 | 10,000 | 5,000 |
  | scatter points | 5,000 | 5,000 | 5,000 | 2,500 | 2,500 | 2,500 |
  | sparklines | all | all | all | all | all | 500 |
  | counters | 500 | 500 | 500 | 200 | 200 | 200 |

  Phone (4x CPU):

  | Workload | Ours, element | Ours, in Vue | Ours, in Angular | A2UI Lit | A2UI React | A2UI Angular |
  |---|---|---|---|---|---|---|
  | nodes (streamed) | 250 | 100 | 250 | 25 | 50 | 25 |
  | static nodes | 500 | 250 | 500 | 50 | none | 25 |
  | depth | 48 | 48 | 2 | none | none | none |
  | table cells | 100 | 100 | 100 | 20 | 100 | 20 |
  | chart points | 50 | 8 | 8 | none | 8 | 8 |
  | frame rate | none | none | none | none | none | none |
  | text churn | 1 | none | none | none | none | none |
  | tone density | none | none | none | none | none | none |
  | heatmap cells | 1,000 | 100 | 100 | 100 | 100 | 25 |
  | scatter points | 100 | 100 | 100 | 100 | 100 | 100 |
  | sparklines | 100 | 25 | 25 | 5 | 25 | 5 |
  | counters | 10 | 10 | 10 | 10 | 10 | 5 |

  Cold start (median, ms; first node / complete / longest task):

  | | Ours, in Vue | Ours, in Angular | A2UI Lit | A2UI React | A2UI Angular |
  |---|---|---|---|---|---|
  | desktop | 9 / 54 / 0 | 3 / 51 / 0 | 31 / 82 / 0 | 19 / 74 / 0 | 65 / 98 / 0 |
  | phone | 30 / 205 / 154 | 68 / 205 / 180 | 250 / 302 / 0 | 172 / 324 / 247 | 254 / 329 / 0 |

- **Reading it.** Differences of one step are noise. Beyond that:
  - A2UI trails the other contenders, most on the phone. Likely causes, not
    yet profiled: its message processor builds a component model and resolves
    each child by id before a framework draws anything, and each component is
    an element or component of its own. A2UI on Angular is the slowest of the
    ten on desktop.
  - A2UI on Lit and Angular show no long task at cold start on the phone, but
    the latest first node (about 250 ms).
  - This SDK's element is about as fast inside Vue or Angular as alone on
    desktop, except static nodes, where the host's update is in the timed
    path. On the phone it keeps its lead on node counts in Angular; in Vue it
    loses steps on node counts, chart points, heatmap cells and sparklines.
  - **Depth on the phone is unstable for this SDK**: frame p95 sits on the
    16.7/33.3 ms boundary at every step. A rerun of the depth ladder alone
    gave "none" for both the element (48 here) and the Angular host (2 here).
    Read the phone depth row as "about the first step" for all of them.
  - **Depth on desktop**: the renderer process crashes at 96 levels in the
    Angular host, as it does for A2UI on Lit and Angular, and at 128 for the
    element alone; repeated on a rerun. Follow-up: find which nesting the
    crash comes from (Blink's own limit, or the host's extra stack).

## Phase 5 — Attacks

- [x] **T-440** Tests: the classifier.
  - a deliberately unsafe renderer is "executed" by every evidence kind:
    canary, policy violation, forbidden DOM, external request, global change,
    bounds escape;
  - a safe one is "blocked" or "inert".
- [ ] **T-441** The injection corpus (`contracts/attacks.md`) and a seeded
  fuzzer, placed in every prop, connector, tier and host.
- [x] **T-442** The protocol and denial-of-service cases, each with its required
  outcome.
- [x] **T-443** The injection tricks: prototype keys, CSS-shaped values, `style`
  and identity attributes through props, overlays, policy bypass.
- [ ] **T-444** The red-team: about twenty prompts × five runs × two local
  models, through the real route; attempt and leak rates.
- [ ] **T-445** The corpus against every contender, with the disclosure gate
  (FR-435).
- [ ] **T-446** Fix every finding in this SDK, each with a test that fails
  without the fix.

### Phase 5 notes (part a: this SDK's own hosts)

Done in this part: the classifier and its self-test (T-440), the corpus and
fuzzer on this SDK's four hosts (T-441, except the library connectors), the
protocol cases (T-442), the injection tricks (T-443), and the fixes for what
they found (T-446, so far). Left for part b: the library connectors
(Bootstrap, Shoelace, MUI, Element Plus, Angular Material) through the example
apps, the red-team (T-444), and the contenders with the disclosure gate
(T-445).

- **The harness** (`bench/src/attacks/`, `pnpm bench:attacks`; the bench
  README has the evidence table). Each case runs in a fresh renderer, read
  from a same-origin route, on a page served with a report-only policy; the
  outcome is decided by rule from six kinds of evidence. `--self-test` shows a
  deliberately unsafe page caught by every kind, and this SDK's element by none.
- **Placement**: each payload in one string prop of one node, every string
  prop of every component in turn (text, URLs and enumerations, the kit's
  included), so a refused node never hides another prop.
- **Five findings, fixed**, each with a test that fails without the fix:

  | Finding | Seen as | Fix |
  |---|---|---|
  | An out-of-order, duplicate or unappliable frame ended as `transport_error`, a network failure | protocol `seq-*` | `stream_malformed`, and nothing of the frame applied (`UIStreamAccumulator`) |
  | No limit on one SSE event: a 100 MB frame froze the page for 47 s at 1.4 GB of heap, 10 MB for 0.5 s at 199 MB; the reader also searched the whole buffer again on every chunk | protocol `oversized-*`, `unterminated-10mb` | events over 8 Mi characters refused with `stream_malformed` (`DEFAULT_MAX_EVENT_LENGTH`, configurable on `decodeSSE`), sockets too; the search resumes where it stopped. Now refused within 150 ms, the page responsive |
  | The element drew an over-depth document down to the limit, where the contract's document schema refuses it | protocol `over-budget-depth` | refused before drawing, with `schema_violation`, as an over-budget node count already was |
  | Model text drew outside its component: chart labels past the chart (the plot does not clip), and an unbroken word out of badges, links and table captions | bounds evidence on every server-tier case with a long payload; trick `overlay.unbroken-word` | the theme clips the chart card and breaks generated text anywhere |
  | A patch path through `__proto__` gave the patched copy a new prototype (no global changed) | review of `applyPatch` for the proto-path case (research R9) | keys are written and read as own properties |

- **Results** (`bench/results/attacks-2026-11-13.json`, fuzz seed 20770, 100
  variants): 1,486 cases, none executed, every protocol requirement met.

  | Host | Full validation | Server tier |
  |---|---|---|
  | element | 179 blocked, 2 inert | 181 inert |
  | React hook | 179 blocked, 2 inert | 179 blocked, 2 inert |
  | element in Vue | 179 blocked, 2 inert | 181 inert |
  | element in Angular | 179 blocked, 2 inert | 181 inert |

  Under full validation nearly every case is blocked: a payload in any
  enumerated or length-limited prop is refused, and a refused node makes the
  case "blocked" though its other nodes drew the payload as text. At the
  server tier the element validates nothing, so every case is drawn, and every
  one is inert: text stays text, and URLs pass the URL guard. The React
  renderer validates props at either tier.

  Protocol cases, element and React hook alike: bad sequences and
  over-budget documents refused within 20 ms; truncation reported as
  `truncated`; malformed JSON and garbage ignored; a slow drip stopped at
  once; 10,000 colliding keys as fast as unique ones (282 against 233 ms); a
  socket flood of 20,000 messages held at 5 MB. The 100 MB case's 440 MB peak
  is the page's own copy of the test frame: the reader refuses it at 8 Mi
  characters.
- **Not a finding**: SSE with bare carriage returns as line ends (allowed by
  the SSE specification) is not read as events, so such a stream ends as
  `truncated`. A refusal, not a risk; recorded for a later fix.

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

Phase 5 part b (the library connectors, T-444, T-445, the rest of T-446) and
phase 6. Follow-ups: the desktop depth crash at 96 in the Angular host, phone
depth sitting on a frame boundary, and SSE with bare carriage returns.
