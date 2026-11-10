# relax-ui-bench: stress, soak and security benchmark

Spec: [specs/004-stress-security-benchmark](../specs/004-stress-security-benchmark/spec.md).
This package is private and never published. Contenders and tools stay here.

```bash
pnpm build                      # the SDK packages
pnpm bench:selftest             # the harness proves itself first
pnpm bench:smoke                # what a pull request runs
pnpm bench                      # every ladder, both profiles
pnpm bench -- --renderer ours-react --workload table-cells --profile phone --reps 5
```

## How a number is made

1. **A workload ladder** (`src/workloads`): seeded documents, one dimension at
   a time. The dimensions are nodes streamed, nodes in one static frame, depth,
   table cells, chart points, frame rate, text churn and tone density. Steps
   above the standard contract's budgets use a bench-only `extend()` with
   raised limits.
2. **One page per renderer** (`pages/`). A scheduler in the page feeds the
   step's frames in the renderer's own wire format at the step's rate, so there
   is no network.
3. **One probe for everyone** (`src/probe`). It records:
   - `requestAnimationFrame` intervals;
   - long animation frames;
   - event timing for a click half-way through the stream;
   - time to the first node and to complete.

   The output is then compared with the reference drawing of the complete
   document.
4. **The runner** (`src/runner`): Playwright and the DevTools Protocol.
   - It applies the desktop or phone profile (CPU 4× slower).
   - It reads heap after forced garbage collection, and DOM counters.
   - Each step gets one warm-up and five repetitions, in fresh pages.
   - Each ladder stops at the first step that breaks a budget.
5. **Budgets** ([contract](../specs/004-stress-security-benchmark/contracts/budgets.md),
   version 2). A step breaks on any of:
   - a 95th-percentile frame interval over 25 ms (dropped frames at 60 fps);
   - a long task over 50 ms;
   - interaction latency over 200 ms;
   - any wrong or missing node;
   - a timeout.

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

Two problems were found before any result was recorded:

- **The self-test showed the frame budget as first written could not be
  measured.** An idle page's 95th-percentile frame interval is 16.8 ms, so
  "over 16.7 ms" failed a page doing nothing. The budget is now version 2: a
  25 ms interval, meaning a refresh was missed.
- **The first smoke run found a generator bug.** Churned text overflowed the
  Badge's 32-character limit. This SDK's React hook rightly stopped the stream,
  while its element quietly refused the badges. The generator's test now
  validates every frame, not only the last.
