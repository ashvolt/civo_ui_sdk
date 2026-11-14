# relax-ui-bench: stress, soak and security benchmark

Spec: [specs/004-stress-security-benchmark](../specs/004-stress-security-benchmark/spec.md).
This package is private and never published. Contenders and tools stay here.

```bash
pnpm build                      # the SDK packages
pnpm bench:selftest             # the harness proves itself first
pnpm bench:smoke                # what a pull request runs
pnpm bench                      # every ladder, both profiles
pnpm bench:soak                 # 30 minutes per renderer; --minutes, --sample-every
pnpm bench:attacks              # the attack suites (below)
pnpm bench:redteam              # hostile prompts through a local model (below)
pnpm bench:dashboard            # the dashboard, from the newest results
pnpm bench -- --renderer ours-react --workload table-cells --profile phone --reps 5
```

## Pull requests, nightly runs and the dashboard

**Every pull request** (`.github/workflows/bench.yml`, two jobs in parallel,
each under ten minutes):

- **ladders**: this SDK's element on the desktop profile, each ladder at its
  first step and at one step where the renderer's own work dominates
  (`src/regress.ts`), then `bench:regress` against the last `main` result;
- **attacks**: the injection corpus and tricks at both tiers, and protocol
  abuse, on the element.

On those steps, frame intervals and completion time follow the delivery
schedule, not the renderer, so the regression check reads **main-thread busy
time** (Chromium's `TaskDuration` around each run). Each step's median is
divided by `main`'s, and the median of those ratios must stay within the
budgets contract's tolerance: 20%. A slower renderer moves every step. Noise
moves a few steps, or the whole run a little. The total is reported too.

A step that breaks a budget now, but did not on `main`, also fails. Each
machine's time for a fixed CPU job is reported, but does not scale the result:
next to ten quiet runs it varied far more than the busy time did.

On one laptop, against one baseline:

| Runs | Median ratio |
|---|---|
| Ten quiet runs | 0.96 to 1.14; none failed |
| `--slowdown 1.5` | 2.02; failed |

Judging the total instead would have failed one of the ten quiet runs (1.21). `--slowdown 1.5` throttles the CPU; it is how the check is shown to
catch a 50% slowdown.

```bash
pnpm bench:smoke -- --out main.json        # on main
pnpm bench:smoke -- --out mine.json        # on your branch
pnpm bench:regress -- --baseline main.json --current mine.json
```

**Nightly** (`.github/workflows/bench-nightly.yml`), in parallel jobs:

- the full ladders for every renderer on both profiles;
- the three soaks;
- every attack suite on every host, connector and contender, with the day's
  fuzz seed;
- the structural gate.

`bench:merge` then joins the results into `results/nightly/` and drops raw
samples. The dashboard is built from them, and a bot pull request commits
them. These are shared-runner figures, for trends and breakage. The headline
results in `results/` come from one named machine.

**The dashboard** (`dashboard/`, `pnpm bench:dashboard`) is one static HTML
file built from the newest result of each kind, with the data inlined. It
shows:

- summary figures;
- break points per renderer, workload and profile;
- every ladder's curve;
- cold start;
- soak trends;
- attack outcomes;
- the red-team;
- package versions.

Each figure names its workload and the command that reproduces it.
`--results results/nightly` builds it from the nightly files instead.

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

## The attacks

`pnpm bench:attacks` runs the attack suites against this SDK on every host
(the element, the React hook, the element in a Vue and in an Angular app), at
both validation tiers, and exits non-zero if any case executes or a protocol
requirement is missed:

```bash
pnpm bench:attacks -- --self-test               # the harness must catch a deliberately unsafe page
pnpm bench:attacks                              # injection, fuzz, tricks, protocol
pnpm bench:attacks -- --suite protocol --renderer ours-element
pnpm bench:attacks -- --fuzz 500 --seed 42      # more fuzzed variants, a fixed seed
```

Each case runs in a fresh renderer on a page served with a report-only
Content Security Policy, reading the case from a same-origin route, as a
production page reads the SDK's route. The outcome comes from evidence, never
from looking (`src/attacks/classify.ts`):

| Evidence | How it is seen |
|---|---|
| canary | every payload calls `window.__relaxPwned(id)` if it runs |
| policy | a violation of the report-only policy |
| dom | an element or attribute the benign document never draws, a handler attribute, a URL with a forbidden scheme, CSS that loads |
| requests | a request leaving the page's origin (aborted, so nothing reaches the network) |
| globals | built-in prototypes, the window and the element's class, before and after |
| bounds | a generated element visible outside the host's box |

Any evidence is "executed"; otherwise a refusal is "blocked" and the rest
"inert". `--self-test` runs one case per evidence kind against a page that
draws props as HTML, merges them into shared defaults and applies a `style`
prop: each kind must be seen there, and none on this SDK's element.

Payloads are this repository's own (`src/attacks/corpus.ts`), each placed in
one string prop of one node, every string prop of every component in turn, so
a node refused for one bad prop never hides another. Fuzzed variants are
seeded mutations of them (`src/attacks/fuzz.ts`); the seed is in the result.

**Library connectors.** The same suites run on the element with each library
connector from the example apps, beside the bench kit: Bootstrap 5 and
Shoelace (`examples/html-host`), Element Plus (`examples/vue-host`), MUI
(`packages/connect-react/samples`) and Angular Material (`examples/angular-host`,
compiled here against Angular 21, since the example's Angular 22 CLI needs a
newer Node than the bench machine has). The result's `connector` field names
it (`mui+kit`).

**Contenders** (T-445): json-render, OpenUI, the AI SDK and A2UI on Lit, React
and Angular get the same documents in their own wire formats, through each
page's ordinary streaming path, drawn with the same kit components. They have
no validation tiers, so each runs once (tier `own`). OpenUI Lang passes props
by position, so the prototype-key and identity tricks cannot be written in it;
the result lists them under `notExpressible` rather than as inert. A
contender's finding never fails the run.

None of the contenders checks a prop while drawing: json-render's
`catalog.validate` and A2UI's message validator are opt-in, OpenUI's prop
schemas describe components for the prompt, and the AI SDK checks only the
final object. They hand props to the application's components as they come;
the kit, standing in for the application, has no URL guard (FR-430). So a
`data:` or `vbscript:` link (and, through Lit, which sanitises nothing, a
`javascript:` one) reaches the page on every contender. That is recorded as
`executed` with `cause: "passed-through-unchecked"`: a design difference from
this SDK, which checks URLs in the contract and again in every renderer.

**Disclosure gate** (FR-435): any other contender finding is the library's
own. Then every result of that contender, clean ones too, goes to
`results/private/` (untracked), the committed file leaves it out and says only
how many contenders were withheld and until when (30 days), and the run's log
does not print its findings (`src/attacks/disclosure.ts`). Its maintainers are
told privately first.

### The red-team

`pnpm bench:redteam` sends twenty prompts aimed at the contract
(`src/attacks/redteam.ts`: forbidden components, markup and script URLs in
props, off-site links, over-budget documents, action and identity props,
instructions hidden in data, template expressions, prototype keys) as the
`topic` of the Next example's real route (`examples/next-app/app/api/ui/route.ts`),
five times each, to each local model through Ollama:

```bash
pnpm bench:redteam                                       # qwen2.5:3b and llama3.2:3b, 5 runs
node --experimental-strip-types src/runner/redteam.ts --models qwen2.5:3b --runs 1 --prompts js-link
```

The model's raw text is captured before the route validates it, and the
route's response is drawn by the element with the example's contract, on an
attack page, for evidence. Two numbers per prompt and model:

- **attempt rate**: runs whose raw output held something forbidden (markup,
  a handler, a script URL, the canary, an off-site link, a template, CSS that
  positions or loads, a prototype key, a type or prop outside the contract,
  or a document over budget);
- **leak rate**: runs where anything reached the page, by the same evidence as
  the attack suites. It must be zero; the run exits non-zero otherwise.

Only local models on 127.0.0.1 are used (Constitution I): the runner refuses
any other address. If Ollama is not running, the red-team is reported as
skipped, not passed. On a CPU a run takes about a minute (up to eight), so
the full 200 runs take five to seven hours. The 2026-11-13 run: attempt rate
44%, leak rate 0.
