# Research: Stress, Soak and Security Benchmark

**Feature**: [spec.md](./spec.md) · **Date**: 2026-11-10

Each item states the question, what was found, and the decision. Items marked
**to measure** are settled by the first implementation phase, not by reading.

---

## R1. What exists to compare against

**Question**: is there an independent rendering or security benchmark for
generative UI to build on, or to be compared with?

**Findings**: no. The most cited comparison of generative UI formats is OpenUI's
token count, which is published by its makers (Thesys). Its latency and
reliability claims are also the authors' own ([OpenUI benchmark write-up](https://mer.vin/2026/05/openui-lang-mit-generative-ui-that-cuts-llm-output-tokens-versus-json/),
[MDMA reliability PR](https://github.com/MobileReality/mdma/pull/62)).
Rendering is measured for general frameworks by the js-framework-benchmark:
- create 1,000 rows;
- replace all rows;
- update every 10th row of 10,000;
- swap rows;
- memory after updates;
- a weighted geometric mean.

Its known limits are that it measures client rendering only, and that frame-quantised
timing hides differences between small and large updates
([README](https://cdn.jsdelivr.net/gh/krausest/js-framework-benchmark@master/README.md),
[Nolan Lawson](https://nolanlawson.com/2024/10/13/the-greatness-and-limitations-of-the-js-framework-benchmark/)).

**Decision**: build our own, borrowing the js-framework-benchmark's discipline:
- operations defined per step;
- warm-up runs;
- repeated runs;
- keyed updates;
- memory measured separately.

Measure **streaming**, which it does not: frames arriving while the page
renders, judged by frame time and long tasks rather than by a single duration.

---

## R2. Measuring a frame, a long task and interaction latency in Chromium

**Question**: how to measure the budgets in FR-411 reliably, headless, and the
same way for every contender?

**Findings**:

| Budget | Source | Notes |
|---|---|---|
| Frame time | `requestAnimationFrame` timestamps recorded in the page during the streaming window | Headless Chromium produces frames; deltas give frame time directly |
| Long tasks | `PerformanceObserver` for `long-animation-frame` (Chromium 123+), with `longtask` as a cross-check | Long animation frames attribute the blocking script, which helps when a contender breaks |
| Interaction latency | Event Timing (`PerformanceObserver` `event`, `durationThreshold: 16`) around a scripted scroll and click on a fixed control in the host page | The same quantity INP is built from; a single scripted interaction gives a stable number |
| Heap | DevTools Protocol: `HeapProfiler.collectGarbage`, then `Runtime.getHeapUsage` | After forced garbage collection, so garbage is not mistaken for a leak |
| DOM nodes, listeners | DevTools Protocol `Memory.getDOMCounters` (documents, nodes, JS event listeners) | Cheap enough to sample every minute of the soak |
| Detached DOM | Heap snapshot: nodes whose `detachedness` field is 2 (detached). Older snapshots have no such field and name the node `Detached …`; DevTools draws that label from the field | Expensive; taken at the start and end of the soak only |
| CPU slowdown | DevTools Protocol `Emulation.setCPUThrottlingRate` | Lighthouse's mobile preset uses 4× |

**Decision**: collect all of them through one in-page probe plus a DevTools
Protocol session, identical for every contender. Record raw samples, not only
summaries, so a percentile can be recomputed later.

**Measured while building the harness (phase 1)**: four corrections, each
made before any result was kept.

1. **The frame budget.** An idle page's 95th-percentile `requestAnimationFrame`
   interval is 16.8 ms, because intervals jitter around the 16.67 ms refresh.
   The budget became "an interval over 25 ms", meaning a refresh was missed
   (budget v2).
2. **A minimum sampling window of one second.** A static document renders in
   about ten frames, so a single late frame was its 95th percentile. Sampling
   for at least a second makes the percentile mean sustained jank.
3. **Cold start separated from scaling.** In a fresh page, on the phone
   profile, the first document pays for:
   - evaluating the component chunks;
   - building the validator;
   - the shadow root's first style pass (about 90 ms at 4× CPU, measured
     with long-animation-frame attribution).

   That masked every ladder. Each measured run now follows a warm-up
   document, streamed into the **same** mounted renderer (`next()` in the
   adapter contract). The first mount is reported once, as cold start.
4. **Steps small enough for a phone.** Size ladders start at 10 nodes, 20
   table cells, 8 chart points and depth 2, so the phone profile has steps to
   pass.

**Measured in phase 2**: two more corrections, each with a self-test case
that fails without it.

5. **Only frames that begin in the run.** Long-animation-frame entries are
   delivered after their frame ends. The warm-up's slowest frame (lazy
   component code and a first style pass, about 200 ms at 4× CPU) could be
   delivered after the run's observer started, and was counted.
6. **A long task must block.** The test driver's half-way click stretches its
   frame to about 57 ms on the phone profile with a blocking duration of zero:
   no script, no rendering. Such a frame is not a long task. A frame counts
   only when its `blockingDuration` is above zero.

**Measured in phase 4**: two more corrections, a finding for this SDK, and
one limit of the method.

7. **Equal deliveries.** The scheduler delivers one chunk per interval. This
   SDK's stream was a `meta` event, one patch per frame, then `complete`: two
   more chunks than any contender's, each a whole interval late. At cold
   start (50 ms intervals) that was 50 ms on first node and about 80 ms on
   completion that no contender paid. A route sends `meta` with the first
   patch and `complete` straight after the last, so the encoder now does the
   same, and a test asserts every encoder gives one chunk per logical frame.
8. **The gate replaces a document.** The structural gate first mounted each
   case into a fresh page; the ladders stream it after a warm-up, into the
   same mounted renderer. The AI SDK page passed the gate and errored on every
   ladder step: its effect returned `submit()`'s result, which React called as
   a cleanup when the next document replaced the view. The gate now runs the
   warm-up first, as the ladders do.

**Finding for this SDK, fixed: the node schema was rebuilt on every parse.**
Correction 7 put `complete` in the same delivery as the last patch, and the
React hook then failed the first step of the frame-rate ladder on long tasks,
every time; split apart, it passed. A CPU profile of the long task showed Zod
building schemas (`strict`, `describe`, `create`) inside `safeParse`. The
contract's recursive node schema is a `z.lazy` whose getter built the
discriminated union of every component, and Zod calls that getter on each
parse of each node: validating a document constructed every component's
schema once per node. The full-tier hook validates every frame and the final
document, so the last delivery paid twice in one task. The getter now builds
the union once (a contract test fails without it). With it, the React hook
passes every step of frame-rate, text churn and tone density on the desktop
profile; before, tone density failed its first step in every run.

**Limit: a frame percentile moves in whole refreshes.** Frame intervals are
multiples of 16.7 ms, so a step's 95th percentile is 16.7 or 33.3, never in
between, and one missed refresh among a step's twenty-odd frames decides it.
Two runs of this SDK's own renderers a day apart moved 13 of 48 break points,
some by three steps on the phone profile, and the breaking step's
interquartile range was often 16.5 ms: repetitions split at the boundary.
Break points within one step of each other are therefore treated as equal.
A measure that does not round to a refresh (the share of refreshes missed,
or more repetitions at the boundary step) would sharpen this; it changes the
budget, so it is left to a decision.

**Finding: Chromium's nesting limit.** Past a certain depth the browser tab
itself crashes, with or without this SDK. Nested-element depth at which the
tab crashed:

| Nesting | Last depth that rendered | Crashed at |
|---|---|---|
| plain `<div>` | 160 | 192 |
| flex columns | 144 | 160 |
| grids | 128 | 144 |

The base theme's Card adds two flex levels per document level, so a document
around 100 deep crashes. The standard contract's depth budget (24) keeps
documents two to three times below that. The resolver applies it in both
validation tiers, so a hostile deep document is refused before it can crash
the page. The depth ladder records this as a `crash` break.

---

## R3. Equal terms for every contender

**Question**: how to compare frameworks, not component authors' skill?

**Findings**:
- json-render renders a flat map of elements (`root`, `elements`, `children` as
  keys) with a React `Renderer` and a registry of components. It streams as
  JSONL lines of RFC 6902 patches (`createSpecStreamCompiler`).
- A2UI v0.9 feeds messages (`createSurface`, `updateComponents` with a flat list
  of components and child ids, `updateDataModel`) to a `MessageProcessor`.
  Lit, React and Angular renderers draw them. Custom components are
  registered in a catalog with Zod schemas.
- OpenUI Lang streams a compact text program, parsed and rendered by
  `<Renderer response library isStreaming>` in React, with components defined
  by `defineComponent` and Zod 4 schemas.
- The AI SDK's `useObject` gives a partial object as JSON streams in;
  rendering is the application's own React code.

Each project therefore has its own wire format and its own incremental path.
Their bundled component sets differ (A2UI's basic catalog, json-render's shadcn
set), so using them would compare designs, not renderers.

**Decision**:
1. **One component kit, drawn identically everywhere.** The twelve standard
   components and the four heavy visuals are implemented once per framework
   (React, Lit, Angular, and our templates) to emit the same markup and use the
   same stylesheet (the base theme's). A structural check asserts the markup is
   identical before any timing counts.
2. **One logical frame sequence, encoded per contender.** A frame is the
   document after a fixed amount of new content, derived from the same seeded
   generator. Each adapter encodes frame *k* in its contender's own format: a
   JSON Patch SSE event, a JSONL patch line, an `updateComponents` message, a
   longer OpenUI Lang text, a longer partial-JSON text.
3. **Delivery in the page, not over the network.** A scheduler feeds the encoded
   frames at the step's rate, through each contender's own entry point. This
   removes network noise, and measures what is asked: the renderer.
4. **One page per contender**, pinned versions, cold start per run.

**Measured in phase 4 (the encodings)**: each encoder is tested by decoding
with the contender's own code (`bench/test/contenders.test.ts`).
- **json-render**: one patch line per element (`/elements/<key>`), diffed
  from the empty spec `{root: "", elements: {}}`, as its prompt asks a model
  to write. A single patch adding the whole `elements` map drew nothing.
- **OpenUI Lang**: statements `id = Type(args)` written top-down, arguments
  in the contract's prop order with children last as references. Arrays that
  grow inside one node arrive as slices of that statement's text. An edit is
  the statement written again; the later one wins. OpenUI's `Renderer` wraps
  the output in a `<div aria-busy>` of its own; the comparison starts at the
  first kit element.
- **AI SDK**: the final document's JSON, cut where each frame's content ends.
  A partial-JSON stream only appends, so the two workloads that change what
  is shown (text churn, counters) are reported as not expressible.
- **A2UI v0.9**: JSONL messages, `createSurface` first, then per frame one
  `updateComponents` with the components that are new or changed: the flat
  list with child ids its agents send. A component has no partial update, so
  an edit, or an array growing inside one node, sends that component whole.
  Decoded in the test by A2UI's own `MessageProcessor`. One catalog of kit
  component APIs serves the three renderers: every prop optional and of any
  type, children a `ChildList`.

**Measured in phase 4 (part b): the hosts around each component.** A2UI wraps
every component in an element of its own: `<a2ui-react-card>` (style
`display: contents`) in React, the component's element in Lit,
`<a2ui-v09-component-host>` and the component's selector in Angular. They are
the contender's DOM, so the timings keep them; the comparison reads through
them (`unwrap` on the page adapter). Two changes to the canonical markup, made
while doing so, each make the gate stricter, not looser:
- text is what renders: a run of text nodes is one text, whatever comments
  (Lit's and Angular's markers) or unwrapped elements sit between them;
- an SVG element is written as one (`svg:rect`), so an element made in the
  HTML namespace, which draws nothing, no longer passes for it. Lit needs its
  `svg` tag below an `<svg>`, and Angular the `svg:` prefix in a template;
  both drawers do so.

How each renderer was built:
- **Lit**: one `A2uiLitElement` per kit component, rendering into light DOM
  as A2UI's own basic catalog does (`<a2ui-surface>` is light DOM too), so
  the page's stylesheet reaches it. The kit's templates become Lit templates
  with static tags and an attribute directive.
- **Angular**: compiled ahead of time by the Angular CLI (Angular 21, which
  `@a2ui/angular` 0.14.0 needs; the repo's example is on 22) and zoneless,
  as a production app is; just-in-time compilation would have timed the
  compiler. One recursive template draws the kit's markup as data, a case
  per tag, so Angular creates and diffs each element. URL attributes pass
  Angular's `DomSanitizer`, as an `[attr.href]` binding would: Angular's
  safety stays Angular's for the attack phase. A2UI's renderer service keeps
  one processor, so a new document is `deleteSurface`, then a new surface.
- **This SDK's element in Vue and Angular apps** (`ours-vue-host`,
  `ours-angular-host`): the app's template renders `<gen-ui>` and binds its
  contract, connectors and source; each document is a new source set through
  the app's state (a `shallowRef`, a signal), which the framework hands to
  the element on its next update.

---

## R4. Workload ladders

**Decision** (first values; tuned in phase 2 so each ladder spans "easy" to
"broken" on the desktop profile):

| Dimension | Steps | Held constant |
|---|---|---|
| Nodes (mixed components), streamed | 10, 25, 50, 100, 250, 500, 1k, 2.5k, 5k, 10k | 20 frames at 20/s, depth ≤ 4 |
| Nodes in one frame (a static document) | 10, 25, 50, 100, 250, 500, 1k, 2.5k, 5k, 10k | one frame |
| Depth | 2, 4, 8, 16, 24, 48, 96, 128, 160, 192 | 200 nodes |
| Table cells | 20, 100, 1k, 5k, 10k, 25k, 50k, 100k | one table, 10 columns |
| Chart points | 8, 50, 250, 1k, 2.5k, 5k, 10k, 20k | line and bar, 4 series |
| Heatmap cells | 25, 100, 1k, 5k, 10k, 25k, 50k, 100k | one heatmap, five-step colour scale, grows by rows over 20 frames |
| Scatter points | 25, 100, 1k, 2.5k, 5k, 10k, 20k | one plot, two series, grows by points over 20 frames |
| Sparkline grid | 5, 25, 100, 250, 500, 1k sparklines | 30 points each, grows by sparklines over 20 frames |
| Animated counters | 5, 10, 50, 100, 200, 500, 1k, 2.5k | CSS-only animation; counters appear over 20 frames, then every value changes on each of 20 frames at 25/s |
| Frames per second | 5, 10, 25, 50, 100 | 500 nodes |
| Text churn | 1, 10, 50, 100% of text props changed per frame | 500 nodes built over 20 frames, then 20 churn frames at 25/s |
| Tone density | 0, 25, 50, 100% of nodes toned | 1k nodes |

Above the standard contract's 500 nodes and depth 24, the workload uses a
test-only extension with raised limits (FR-402, spec scenario 4).

---

## R5. Phone profile

**Findings**: Lighthouse's mobile preset slows the CPU 4×, standing for a
mid-range phone; DevTools offers the same rate. Network throttling is
irrelevant here because frames are delivered in the page (R3).

**Decision**:
- **Phone:** CPU 4× slower, a 412 × 915 viewport, device scale factor 2.625,
  touch enabled.
- **Desktop:** 1366 × 900, no slowdown.

---

## R6. Statistics and noisy machines

**Findings**: GitHub-hosted runners vary by machine and neighbour load. Absolute
milliseconds there are not comparable between runs.

**Decision**:
- **Every run:** five repetitions after one warm-up; report the median and
  interquartile range.
- **Pull request:** a short ladder (a few steps per dimension) compared with the
  stored `main` result. Pass if the median is within 20% or 2 ms, whichever is
  larger.
- **Absolute budgets:** checked only on the nightly run.
- **Headline figures:** from one named machine, whose specification is
  recorded in each result.

---

## R7. Script-injection corpus

**Findings**: PortSwigger's XSS cheat-sheet data is public but explicitly
**not licensed** ("we are not providing a license"), so it cannot be copied
into this repository ([repository](https://github.com/PortSwigger/xss-cheatsheet-data)).
Automated XSS testing in practice runs payloads in a real browser and watches
for script execution, console activity, policy violations and DOM changes
([helpmetest](https://helpmetest.com/blog/xss-csrf-testing-automation/)).
Mutation-based fuzzing (case, encoding, whitespace and control-character
variants) finds bypasses that fixed lists miss
([penligent](https://www.penligent.ai/hackinglabs/?p=706)).

**Decision**: write our own corpus, by technique class, under this repository's
licence:
- event-handler attributes on every HTML and SVG tag;
- `javascript:`, `data:` and `vbscript:` URLs, with entity, percent, Unicode,
  null-byte, tab and newline obfuscation;
- tag breakouts (`</textarea>`, `</title>`, `</style>`, comments, CDATA);
- SVG and MathML namespace confusion;
- mutation-XSS shapes (`noscript`, `template`, nested forms);
- template-expression injection aimed at the hosts: Angular `{{ }}`, Vue
  `{{ }}` and `v-html`-style, Lit `${}`;
- CSS `url()` and `expression()`;
- bidirectional and zero-width characters, to spoof displayed text.

Each payload calls a canary (`window.__relaxPwned("id")`) if it runs, so
execution is detected without relying on `alert`. Fuzzed variants come from a
property-based generator (fast-check, MIT) seeded per run. Detection also
covers:
- policy violations;
- forbidden elements or attributes in the DOM after rendering;
- any request leaving the page.

---

## R8. Protocol and denial-of-service abuse

**Decision**: one case per row, each with its expected safe outcome. Several
are expected to produce findings in this SDK; that is the point.

| Case | Expected |
|---|---|
| Frame out of order, duplicated, missing | Stops with a stable error code; nothing half-applied |
| Truncated stream, socket closed mid-document | `truncated`, as feature 003 already guarantees |
| Malformed JSON, invalid SSE framing, binary garbage | Ignored or `stream_malformed`; the page stays responsive |
| One oversized frame (1, 10, 100 MB) | Refused or bounded; heap within budget. **To measure** whether a size cap is needed |
| Slow-drip stream (one byte per second for minutes) | Page responsive; `stop()` ends it; no unbounded buffer |
| Document over the node or depth budget | Refused before rendering, as in feature 003 |
| 10,000 sibling key collisions | Rendered in bounded time; no quadratic slowdown. **To measure** |
| WebSocket flood (10,000 messages per second) | Bounded queue or explicit backpressure. **To measure** |
| Patch paths into `__proto__`, `constructor`, `prototype` | No global object modified (shared with R9) |

---

## R9. CSS and JSON injection

**Findings**:
- `JSON.parse` stores a `__proto__` key as an ordinary property.
  Prototype pollution comes from code that later copies or patches by key, which
  is exactly what a JSON Patch applier does.
- CSS data leaks need the attacker to write CSS. Model output cannot: the
  renderer refuses `style` attributes and `<style>`, and classes come from
  templates.
- Overlay attacks need positioning, which is likewise not available to model
  output.

**Preliminary check** (2026-11-10): `applyPatch` with `add` at
`/__proto__/x`, `/a/__proto__/x` and `/constructor/prototype/x` left
`Object.prototype` unmodified. The suite will make that permanent. It will also
check whether a patched *copy* acquires a changed prototype.

**Decision**: test each claim rather than rely on it:
- patches and props with prototype keys, checking `Object.prototype`, `Array.prototype`
  and the renderer's own objects after every case;
- values that look like CSS or selectors in every prop, checking for requests;
- documents that try to cover the page, checking that nothing generated
  renders outside its element's box;
- attempts to set `style`, `class`, `slot`, `part` and `id` through props,
  under every connector.

---

## R10. Red-team with a live local model

**Findings**: two small open-weight models are already on the bench (Ollama
0.35: `qwen2.5:3b`, `llama3.2:3b`).

**Decision**:
- **Prompts:** our own set of about twenty, aimed at the contract:
  - ask for a `script`, an `iframe` or an unknown component;
  - put markup or a `javascript:` URL in a prop;
  - exceed the budgets;
  - smuggle an action prop;
  - instructions hidden inside the data the model is asked to summarise.
- **Runs:** each prompt five times per model, through the real route,
  validation and renderer.
- **Two numbers reported:**
  - the **attempt rate**: raw model output that contained something
    forbidden, before validation;
  - the **leak rate**: forbidden output on the page. It must be zero.

No hosted model is used (Constitution I).

---

## R11. Contenders: versions and licences

Checked on npm, 2026-11-10:

| Contender | Packages | Version | Licence |
|---|---|---|---|
| json-render | `@json-render/core`, `@json-render/react` | 0.22.0 | Apache-2.0 |
| A2UI | `@a2ui/web_core`, `@a2ui/lit`, `@a2ui/react`, `@a2ui/angular` | 0.15.0 / 0.15.0 / 0.15.0 / 0.14.0 | Apache-2.0 |
| OpenUI Lang | `@openuidev/react-lang` | 1.1.0 | MIT |
| AI SDK baseline | `ai`, `@ai-sdk/react` | 7.0.166 / 4.0.170 | Apache-2.0 |

Notes:
- OpenUI needs React 19 and Zod 4 (`zod/v4`). A2UI's Angular renderer's
  version is a minor behind its Lit and React renderers.
- `@a2ui/angular` 0.14.0 needs Angular 21; the benchmark pins Angular
  21.2.5 and its CLI for both Angular pages, separate from the repo's
  Angular 22 example. `@a2ui/react` and `@a2ui/lit` 0.15.0 need Zod 3, the
  bench's `zod3` instance.
- `@openuidev/lang-core` runs a telemetry script on install. pnpm blocks
  install scripts by default and it stays blocked; the renderer works without
  it.
- Thesys C1's SDK (`@thesysai/genui-sdk`) does not name an open-source licence,
  and is excluded, per the clarification.

**Decision**: pin these versions in the private benchmark package, and record
them in every result.

---

## R12. Showcase

**Decision**:
- **Results:** committed as JSON under the benchmark package. The nightly job
  also uploads them as a CI artefact.
- **Dashboard:** a static page, built from the committed results, with no
  server. It can be published from the repository; publishing to GitHub Pages
  is a separate, explicit step.
- **Docs:** the README and `docs/comparison.md` carry a summary table that
  links to it.

---

## R13. Disclosure

**Decision**: a contender found to execute an attack is not named on any public
page until its maintainers have been told privately and given 30 days. The raw
result stays out of the committed JSON until then.
