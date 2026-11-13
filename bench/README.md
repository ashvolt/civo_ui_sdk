# relax-ui-bench: stress, soak and security benchmark

Spec: [specs/004-stress-security-benchmark](../specs/004-stress-security-benchmark/spec.md).
This package is private and never published. Contenders and tools stay here.

```bash
pnpm build                      # the SDK packages
pnpm bench:selftest             # the harness proves itself first
pnpm bench:smoke                # what a pull request runs
pnpm bench                      # every ladder, both profiles
pnpm bench:soak                 # 30 minutes per renderer; --minutes, --sample-every
pnpm bench -- --renderer ours-react --workload table-cells --profile phone --reps 5
```

## How a number is made

1. **A workload ladder** (`src/workloads`): seeded documents, one dimension at
   a time. The dimensions are nodes streamed, nodes in one static frame, depth,
   table cells, chart points, frame rate, text churn and tone density, and four
   heavy visuals: heatmap cells, scatter points, sparklines and animated
   counters. Steps above the standard contract's budgets use a bench-only
   `extend()` with raised limits, which also declares the heavy visuals.
2. **One markup kit** (`src/kit`). The heavy visuals are templates (markup as
   data) styled from base-theme tokens only, like the base theme's own
   components. `<gen-ui>` takes them as a template connector and React through
   `fromTemplates`, so every renderer draws the same elements. Counters animate
   with CSS only, and not at all under `prefers-reduced-motion: reduce`.
3. **One page per renderer** (`pages/`). A scheduler in the page feeds the
   step's frames in the renderer's own wire format at the step's rate, so there
   is no network.
4. **One probe for everyone** (`src/probe`). It records:
   - `requestAnimationFrame` intervals;
   - long animation frames;
   - event timing for a click half-way through the stream;
   - time to the first node and to complete.

   The output is then compared with the reference drawing of the complete
   document.
5. **The runner** (`src/runner`): Playwright and the DevTools Protocol.
   - It applies the desktop or phone profile (CPU 4× slower).
   - It reads heap after forced garbage collection, and DOM counters.
   - Each step gets one warm-up and five repetitions, in fresh pages.
   - Each ladder stops at the first step that breaks a budget.
6. **Budgets** ([contract](../specs/004-stress-security-benchmark/contracts/budgets.md),
   version 2). A step breaks on any of:
   - a 95th-percentile frame interval over 25 ms (dropped frames at 60 fps);
   - a long task over 50 ms;
   - interaction latency over 200 ms;
   - any wrong or missing node;
   - a timeout.

## Contenders and the structural gate

Other open-source renderers run the same ladders through their own entry
points: json-render (`useUIStream`, JSONL patches), OpenUI Lang (`<Renderer>`
reading a growing program), the AI SDK (`useObject`, partial JSON), and A2UI
in Lit, React and Angular (v0.9 messages into a `MessageProcessor`). Each
draws the same kit, through a drawer per framework (`src/kit/react.ts`,
`src/kit/lit.ts`, `angular/kit/kit.ts`), and each frame sequence is encoded in
the contender's own format (`src/runner/contenders.ts`). This SDK's element
also runs inside a Vue and an Angular app (`ours-vue-host`,
`ours-angular-host`).

The two Angular pages (`angular/`) are built ahead of time by the Angular CLI,
as an Angular app is, by the same `node build.mjs`; that adds about 40
seconds. `BENCH_SKIP_ANGULAR=1` reuses the last Angular build. The encodings are tested by decoding with the
contender's own code (`test/contenders.test.ts`).

Before any timing counts, `pnpm bench:gate` checks every renderer draws the
reference's markup: the every-component document and the first two steps of
each ladder, after a warm-up document. A workload a format cannot write is
reported as not expressible, with the reason, and not timed.

```
pnpm bench:gate                          # every renderer that ladders
pnpm bench --renderer ours-element,json-render,openui,ai-sdk
```

## The soak

`pnpm bench:soak` streams a cycle of five documents into one mounted
renderer, round and round: each is patched frame by frame as it streams, then
replaced by the next. Every minute, the run pauses when document 0 is complete
again, forces garbage collection, and reads the heap, DOM nodes, event
listeners, and the framework components still mounted. A heap snapshot at the
start and the end counts detached DOM nodes.

It breaks on heap growth over 10% (median of the first five samples against
the last five), on any growth in DOM nodes, listeners or detached nodes, or on
mounted components that differ from the document's. Three renderers soak:
this SDK's element, its React renderer, and the element with a React framework
connector (`ours-connect-react`), whose mounts are counted.

Results are JSON, checked against the [result schema](../specs/004-stress-security-benchmark/contracts/results.md)
before they are written, under `results/`.

## The self-test

`pnpm bench:selftest` must classify four renderers before any result is
trusted:

| Renderer | Must |
|---|---|
| this SDK's element, untouched | pass |
| one that blocks 80 ms per frame | break on the long-task budget |
| one that drops a node | break on correctness |
| one that never finishes | break on the timeout |

It then checks the heavy visuals: the element draws a small step of each
correctly, and its counters run animations, except when the page asks for
reduced motion, when none run.

Last, the soak's detection, in 30-second soaks: a steady page passes, a page
that adds a window listener per document breaks on listeners, and a page that
keeps each replaced document breaks on detached DOM.

Two problems were found before any result was recorded:

- **The self-test showed the frame budget as first written could not be
  measured.** An idle page's 95th-percentile frame interval is 16.8 ms, so
  "over 16.7 ms" failed a page doing nothing. The budget is now version 2: a
  25 ms interval, meaning a refresh was missed.
- **The first smoke run found a generator bug.** Churned text overflowed the
  Badge's 32-character limit. This SDK's React hook rightly stopped the stream,
  while its element quietly refused the badges. The generator's test now
  validates every frame, not only the last.
