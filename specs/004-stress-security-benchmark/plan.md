# Implementation Plan: Stress, Soak and Security Benchmark

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md) ·
**Data model**: [data-model.md](./data-model.md) · **Contracts**: [contracts/](./contracts/) ·
**Quickstart**: [quickstart.md](./quickstart.md) · **Tasks**: [tasks.md](./tasks.md)

---

## Summary

A private benchmark package and its CI jobs. The package will:

- generate seeded workloads;
- render them with this SDK and four open-source contenders, through each
  contender's own streaming path, drawing identical markup;
- measure frame time, long tasks, interaction latency, memory and DOM growth
  in Chromium on a desktop and a phone profile;
- climb each ladder to the step where a stated budget breaks;
- soak for 30 minutes;
- run four families of attack.

Results are versioned JSON, shown on a static dashboard and summarised in the
README. Every pull request runs a short version; the full run is nightly.

---

## Technical Context

| | |
|---|---|
| **Language** | TypeScript (strict), as the rest of the repository |
| **Browser** | Chromium via Playwright (already a dev dependency), DevTools Protocol sessions for memory, DOM counters and CPU slowdown |
| **Bundling** | esbuild for plain, React and Lit pages; the Angular CLI (as in `examples/angular-host`) for the A2UI Angular page |
| **Fuzzing** | fast-check (MIT), seeded |
| **Model** | Ollama, local, `qwen2.5:3b` and `llama3.2:3b` |
| **New runtime dependencies in published packages** | none |
| **Where** | a private workspace package, `bench/`, outside `packages/`, so the release build (`./packages/*`) never sees it |
| **Runs** | pull request: under 10 minutes; nightly: under 120 minutes (NFR-402) |

---

## Constitution Check — pre-design

| Principle | Question | Status |
|---|---|---|
| I. Sovereignty | Does anything contact a host other than the machine? | PASS: contenders are installed in advance; frames are delivered in the page; the model is local |
| II. Schema is the contract | Do heavy visuals bypass the contract? | PASS: they are an `extend()` of the standard contract, used only by the benchmark |
| III. Capability negotiated | Not affected | n/a |
| IV. Untrusted input | Are any controls relaxed for the benchmark? | PASS: none. The test-only contract raises budgets inside the benchmark only; attack suites add evidence |
| V. Edge, dependencies | Do contenders or tools reach a published package? | PASS: development dependencies of an unpublished package; CI asserts it |
| VI. Specification first | Spec, research, plan, data model, contracts, tasks before code | PASS |
| VII. Tests that would fail | Are budgets set before results are seen? Do attacks assert refusal? | PASS: budgets are in `contracts/budgets.md` now; each attack names its safe outcome |

---

## Project Structure

```
bench/                              private package "relax-ui-bench" (never published)
  package.json                      contenders pinned (R11), fast-check, esbuild, Playwright
  src/
    workloads/   generator.ts       seeded documents and frame sequences (R4)
                 ladders.ts         one ladder per dimension
                 contract.ts        bench-only extend(): Heatmap, Scatter, SparklineGrid, AnimatedCounter; raised limits
    kit/         templates.ts       the four heavy visuals as markup-as-data templates
                 react.tsx · lit.ts · angular/   draw any template, so markup is identical everywhere (D2)
    adapters/    ours-element · ours-react · ours-vue-host · ours-angular-host
                 json-render · a2ui-lit · a2ui-react · a2ui-angular · openui · ai-sdk
    probe/       in-page: frame times, long animation frames, event timing, scheduler
    runner/      Playwright + DevTools Protocol, profiles, budgets, ladder, soak, results writer
    attacks/     corpus.ts · fuzz.ts · protocol.ts · tricks.ts · redteam.ts · classify.ts
  pages/                            one entry per adapter, built into bench/dist
  results/                          committed JSON (schema in contracts/results.md)
  dashboard/                        static page built from results/
.github/workflows/bench-nightly.yml scheduled full run
.github/workflows/ci.yml            + "Bench smoke" job
```

---

## Design decisions

### D1 — A private package outside `packages/`
Contenders bring React 19, Lit, Angular, Zod 4 and several renderers. None of it
may reach a published package (NFR-401). Keeping it outside `packages/` keeps it
out of the release build by construction. A CI check asserts that no published
package depends on it.

### D2 — One markup kit, drawn identically by every contender
The base theme's templates are already markup as data (`VNode`). Each
framework gets one small "draw a template" component: React, Lit, Angular, and
the DOM renderer we already have. Each contender's components call the same
template. Every contender therefore produces the same elements, classes and
text. A structural equality check, like feature 003's four-host test, must
pass before any timing is recorded (R3).

### D3 — Logical frames, encoded per contender, delivered in the page
The generator produces frame *k* as a document. Each adapter encodes it in
its contender's own format and feeds it through the contender's own entry point:
- this SDK: a JSON Patch SSE event;
- json-render: a JSONL patch line;
- A2UI: an `updateComponents` message;
- OpenUI: a longer OpenUI Lang text;
- AI SDK: a longer partial-JSON text.

A scheduler in the page sets the rate. There is no network, so the renderer is
what gets measured (R3).

### D4 — One probe, the same for everyone
An in-page probe records:
- `requestAnimationFrame` deltas;
- `long-animation-frame` entries;
- event timing for one scripted interaction.

A DevTools Protocol session collects heap after forced garbage collection, DOM
counters, and applies the CPU slowdown. Raw samples are kept (R2).

### D5 — Budgets and ladders as data
Budgets and their tolerances live in one versioned file, mirrored from
[contracts/budgets.md](./contracts/budgets.md). A ladder stops at its first
broken step. A step is broken by a budget, a wrong node, or a timeout
(FR-411, FR-412).

### D6 — Two cadences
- **Pull request ("Bench smoke"):** the first three steps of each ladder, our
  renderer only, desktop profile, plus the injection corpus and the protocol and
  injection-trick suites. It compares with the stored `main` result within the
  tolerance (R6).
- **Nightly:**
  - every ladder, on both profiles, for every contender;
  - the 30-minute soak;
  - all four attack families.

  Results are uploaded and committed by a bot pull request.

### D7 — An attack harness that cannot be fooled by a quiet failure
Every case is classified from evidence:
- whether the canary was called;
- policy violations;
- a DOM scan for forbidden elements, attributes and URLs;
- requests leaving the page;
- `Object.prototype` and friends compared before and after;
- element bounds.

**Blocked**, **rendered inert** and **executed** are decided by rule, not by
eye. Against this SDK, anything other than blocked or inert fails. Against a
contender, the outcome is recorded (FR-434).

### D8 — Versioned results, a static dashboard
Results are JSON with `schemaVersion`. The dashboard is a static page built
from them, with no server. Every figure links to its workload, and shows the
command that reproduces it (FR-443, FR-450).

### D9 — Disclosure gate
A contender outcome of "executed" is written to an untracked file, not to the
committed results, until its maintainers have been told (FR-435, R13).

---

## Phase plan

### Phase 0 — Research → [research.md](./research.md) (done)
### Phase 1 — Design → [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md) (done)
### Phase 2 — Tasks → [tasks.md](./tasks.md) (done)
### Phase 3 — Implementation, in six releasable steps

| Step | Delivers | Result you can show |
|---|---|---|
| 1. Harness | `bench/`, generator, probe, runner, budgets, results schema; this SDK's element and React renderer, on both profiles | This SDK's break points |
| 2. Heavy visuals | bench contract, kit templates in every framework | Heatmap, scatter, sparkline and counter ladders |
| 3. Soak | 30-minute run with memory and DOM tracking | Leak evidence over time |
| 4. Comparison | the eight adapters (this SDK in four hosts, json-render, A2UI ×3, OpenUI, AI SDK baseline), structural gate | Head-to-head break points |
| 5. Attacks | corpus and fuzz, protocol abuse, injection tricks, red-team; run against contenders too | Attack outcome matrix |
| 6. Show | smoke CI job, nightly workflow, dashboard, README and comparison summary | Published results |

Findings in this SDK from steps 1, 3 and 5 are fixed in the step that finds
them, each with a test that fails without the fix.

---

## Constitution Check — post-design

| Principle | Status |
|---|---|
| I | PASS: the probe, scheduler and adapters run in the page; the red-team calls `127.0.0.1` only |
| II | PASS: heavy visuals declared through `extend()` with schemas and roles |
| IV | PASS: no control is bypassed; fixes from findings tighten them |
| V | PASS: `bench/` is private and outside `packages/` |
| VI | PASS |
| VII | PASS: budgets fixed in a contract before measurement; every attack asserts its outcome |

### Complexity Tracking

| Addition | Why it is needed | Simpler alternative rejected |
|---|---|---|
| Four framework drawers for one kit | Equal markup is the only way the comparison measures renderers, not component design | Each contender's own components: compares designs, not renderers |
| An Angular build for one adapter | A2UI ships an Angular renderer; comparing framework against framework needs it | Skip it: loses the only like-for-like Angular comparison |
| A nightly workflow | The full run takes about 1–2 hours; too long for every PR | Everything per PR: doubles CI time |

---

## Verification (to be filled when implemented)

| Gate | How |
|---|---|
| Equal terms | structural equality of every contender's markup for every workload, before timing |
| Budgets fixed in advance | `contracts/budgets.md` committed before the first result |
| Reproducible | the same seed and machine, run twice, within the reported spread |
| Ladder correctness | a deliberately slowed renderer breaks at an earlier step; a deliberately wrong renderer breaks on correctness |
| Attack harness | a deliberately unsafe renderer (inserting HTML) is classified "executed" for every family it should fail |
| PR smoke | a deliberate 50% slowdown fails the check; noise alone does not, over ten runs |
| Isolation | no published package depends on `bench/` (CI) |

---

## Known limitations (expected)

1. Chromium only. Firefox and WebKit are a later addition.
2. Delivering frames in the page excludes network time. That is deliberate:
   it measures renderers, not transports.
3. One markup kit measures framework overhead, not how a contender's own
   component library performs.
4. Small local models only in the red-team; larger or hosted models may try
   different things.
5. CI runners are noisy. Absolute figures come from one named machine.
