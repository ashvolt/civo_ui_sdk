# Data Model: Stress, Soak and Security Benchmark

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

```
Workload ─< Step ─< Frame
   │          │
   │          └─< Run (per Renderer × Profile) ─< Sample
   │                     │
   └── Ladder result ────┴── Break point (Budget)

AttackCase ─< AttackOutcome (per Renderer × Host × Connector × Tier)

Result file = { environment, workloads, ladders, soak, attacks }
```

---

## 1. `Workload`

| Field | Notes |
|---|---|
| `id` | e.g. `nodes`, `table-cells`, `heatmap` |
| `dimension` | the one quantity that varies (FR-403) |
| `seed` | integer; the same seed gives the same documents on any machine (FR-401) |
| `steps` | ordered sizes, smallest first |
| `contract` | `standard` or `bench` (raised limits, heavy visuals) |
| `rate` | frames per second, unless the dimension is the rate |

**Invariants**

- W1. `steps` strictly increase.
- W2. A step whose document exceeds the standard contract's budgets uses
  `contract: "bench"` (spec scenario 4).
- W3. Every renderer gets the same `Frame` sequence for a step (FR-404).

## 2. `Frame`

The document after a fixed amount of new content. It is held as a document,
and encoded by each adapter into its contender's wire format.

- F1. Frame *k+1* is frame *k* plus content; nothing is removed, except in the
  text-churn workload, which changes text in place.
- F2. The last frame equals the step's complete document.

## 3. `Profile`

| Field | Desktop | Phone |
|---|---|---|
| `cpuSlowdown` | 1 | 4 |
| `viewport` | 1366 × 900 | 412 × 915 |
| `deviceScaleFactor` | 1 | 2.625 |
| `touch` | no | yes |

## 4. `Budget`

| Field | Notes |
|---|---|
| `metric` | `frameP95`, `longestTask`, `interaction`, `heapGrowth`, `correctness`, `timeout` |
| `limit` | number and unit |
| `breaks` | `true`: exceeding it breaks the step |
| `tolerance` | for pull-request regression: relative and absolute floor |

Values are fixed in [contracts/budgets.md](./contracts/budgets.md) before
any result exists (Constitution VII).

## 5. `Run` and `Sample`

A step rendered by one renderer on one profile, one warm-up then five
repetitions (R6).

| Sample field | Source |
|---|---|
| `frames[]` | `requestAnimationFrame` deltas while streaming, in ms |
| `longFrames[]` | `long-animation-frame` durations, with the blocking script's attribution |
| `interaction` | event-timing duration of the scripted interaction |
| `firstNode`, `complete` | ms from the first frame delivered |
| `heap` | bytes after forced garbage collection |
| `domNodes`, `listeners` | DevTools Protocol DOM counters |
| `correct` | the structural check against the expected document |

**Invariants**

- R1. A run with `correct: false` is broken, whatever its timings.
- R2. Raw samples are kept, so a percentile can be recomputed later.

## 6. `LadderResult` and `BreakPoint`

| Field | Notes |
|---|---|
| `renderer`, `profile`, `workload` | what it is |
| `steps[]` | the median and interquartile range of each metric per step |
| `breakPoint` | the last passing step, `"below-first-step"`, or `"not-reached"` |
| `brokenBy` | the budget (or `correctness` / `timeout`) at the first broken step |
| `expressible` | `false` with a reason when the contender cannot express the workload (FR-422) |

## 7. `Renderer` (contender)

| Field | Notes |
|---|---|
| `id` | `ours-element`, `ours-react`, `ours-vue-host`, `ours-angular-host`, `json-render`, `a2ui-lit`, `a2ui-react`, `a2ui-angular`, `openui`, `ai-sdk` |
| `packages` | name → exact version |
| `streaming` | the contender's own incremental path used |
| `available` | `false` with a reason when it failed to install or load this run |

## 8. `AttackCase` and `AttackOutcome`

| Case field | Notes |
|---|---|
| `id`, `family` | `injection`, `protocol`, `tricks`, `redteam` |
| `technique` | e.g. `event-handler`, `js-url-obfuscated`, `mxss`, `template-expression`, `oversized-frame`, `proto-key` |
| `payload` | the string, frame sequence or prompt |
| `placement` | component, prop, connector, tier, host |
| `expected` | `blocked` or `inert` |

| Outcome field | Notes |
|---|---|
| `outcome` | `blocked`, `inert` or `executed` |
| `evidence` | canary calls, policy violations, forbidden DOM found, external requests, global diffs, bounds escapes |
| `errorCode` | the stable code when the renderer refused (protocol family) |
| `embargoed` | `true` for a contender's `executed` outcome until disclosed (FR-435) |

**Invariants**

- A1. Any `executed` outcome for an `ours-*` renderer fails the suite.
- A2. Evidence decides the outcome; a case with no evidence either way is
  `blocked` only if the renderer reported a refusal, else `inert`.
- A3. Embargoed outcomes are never written to committed results.

## 9. Result file

See [contracts/results.md](./contracts/results.md).

- `schemaVersion`
- `environment`: machine, CPU, memory, OS, browser version, commit, date
- `workloads`, `ladders`, `soak`, `attacks`
