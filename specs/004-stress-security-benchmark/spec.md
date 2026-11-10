# Feature Specification: Stress, Soak and Security Benchmark

**Feature Branch**: `004-stress-security-benchmark`
**Created**: 2026-11-10
**Status**: In progress — phase 1 (harness, and this SDK's ladders on desktop and phone) implemented; phases 2–6 outstanding
**Input**: "So we need to stress load, with low to highest possible animations
graphs, text colours high level of data tables, and what possible load anxiety
test we can do, we should create a automation test. Which includes the security
test, where possible security attacks also. … So we need to know the threshold
of this, so we can compare with other and showcase."

> Write *what* and *why*. Technology choices belong in `plan.md`.

---

## Context

Feature 003 is tested for correctness: 736 unit tests and 42 browser tests prove
that documents render the same in every host, that refusals hold, and that
nothing unsafe reaches the page. None of them answers three questions that
anyone choosing a generative UI renderer will ask:

| Question | What exists today |
|---|---|
| Where does it break? How many nodes, table cells, chart points or frames per second before a page stutters, on a laptop and on a phone? | One measurement: 300 React roots in 14 ms. No ladder, no phone profile, no soak |
| Is it faster or slower than the alternatives? | Nothing independent. Published comparisons between generative UI formats count tokens, and come from the projects' authors |
| What happens under attack? | Refusal tests per control. No attack corpus, no fuzzing, no abuse of the stream itself, and no model actively trying to break out |

This feature builds the automated suites that answer them, with thresholds
stated in advance, and publishes the results so they can be compared and
reproduced.

---

## Clarifications

### Session 2026-11-10

- Q: Which projects are compared? → **A: the open-source renderers of generative
  UI:** json-render (React), A2UI (its Lit, Angular and React renderers), OpenUI
  Lang (React), and a baseline of the Vercel AI SDK's `useObject` with
  hand-written components. A hosted or not clearly open-licensed SDK is not
  compared. (FR-420.)
- Q: How far does the load go? → **A: to the break point, on a desktop profile
  and a throttled mid-range phone profile**, beyond the contract's default
  budgets, using a test-only contract with raised limits. (FR-411, FR-413.)
- Q: How are animations, graphs and colour-heavy data stressed? → **A: a
  bench-only contract extension** (heatmap, scatter plot with thousands of
  points, sparkline grid, animated counters) added through `extend()`. The
  standard twelve do not change. (FR-402.)
- Q: Which attacks? → **A: all four families:** script-injection payloads with
  fuzzing; protocol and denial-of-service abuse; CSS and JSON injection tricks;
  a red-team of a live local model. (FR-430 to FR-433.)
- Q: When do the suites run? → **A: a short version on every pull request,
  against fixed budgets; the full ladder, the soak and the comparison nightly.**
  (FR-440, FR-441.)
- Q: What counts as breaking? → **A: web performance budgets:** 95th-percentile
  frame time while streaming over 16.7 ms, any long task over 50 ms,
  interaction latency over 200 ms, heap growth over 10% across a 30-minute
  soak, or any missing or wrong node. (FR-411.)
- Q: How are results shown? → **A: an interactive dashboard, the raw results
  committed as JSON, and a summary in the README and the comparison
  document.** (FR-450 to FR-452.)

No `[NEEDS CLARIFICATION]` markers remain.

---

## User Scenarios & Testing

### Primary User Story

Priya is the UI architect for a public-sector portal. Her team wants generated
dashboards: tables of thousands of rows, dense heatmaps, charts that update as a
model streams. Two other teams have proposed json-render and A2UI. Her security
lead will not approve any renderer until someone shows what it does with
hostile input, and her product owner wants to know whether it holds up on the
mid-range Android phones most citizens use.

Today she would have to build a test rig for each candidate, invent
comparable workloads, and decide what "too slow" means after seeing the
numbers. With this feature she runs one command, or opens the latest nightly
dashboard. She gets each renderer's break point per kind of load, on a laptop
and on a phone, with the budget it broke, and every attack with its outcome.
She can see the workload behind any number and reproduce it.

### Acceptance Scenarios

**Load**

1. **Given** a workload ladder for one dimension (for example table cells),
   **When** it runs for a renderer on a profile,
   **Then** each step records the metrics, the ladder stops at the first step
   that exceeds any budget, and the result names the break point and which
   budget was exceeded.

2. **Given** the same ladder on the phone profile,
   **When** it runs,
   **Then** the CPU is slowed as declared, and the result is reported beside the
   desktop result, not instead of it.

3. **Given** any step,
   **When** it completes,
   **Then** the rendered output is checked against the expected document. A
   missing or wrong node is a break, however fast the step was.

4. **Given** a workload whose generated document exceeds the standard contract's
   budgets,
   **When** it is rendered with the standard contract,
   **Then** it is refused as in feature 003. Only the test-only contract with
   raised limits renders it, and the result says which contract was used.

5. **Given** heavy visuals (a heatmap of 10,000 cells, a scatter plot of 5,000
   points, a grid of 500 sparklines, 200 animated counters),
   **When** they stream,
   **Then** frame time and long tasks are measured while the animations run.
   Under `prefers-reduced-motion` the counters do not animate.

**Soak**

6. **Given** a 30-minute run that keeps replacing and patching documents,
   **When** it ends,
   **Then** the result reports heap growth after forced garbage collection, the
   change in DOM node count, in event listeners, and in mounted framework
   components. Growth over the budget fails it.

**Comparison**

7. **Given** the same workload and the same frame sequence,
   **When** each contender renders it,
   **Then** each uses its own streaming path and its own renderer, with
   components drawing identical markup. Each runs in its own page, and its
   version and the machine are recorded with the result.

8. **Given** a workload a contender cannot express (for example a component kind
   or a streaming mode it lacks),
   **When** the comparison runs,
   **Then** that cell is reported as "not expressible", with the reason, never as
   a failure or a zero.

**Security**

9. **Given** the script-injection corpus and its fuzzed variants,
   **When** each payload is placed in every text and URL prop, of every component,
   through every connector, in both validation tiers, in every host,
   **Then** no script runs, no policy violation fires, and no forbidden element,
   attribute or `javascript:` URL appears. Any of those is a failure.

10. **Given** a malformed, out-of-order, truncated, oversized or deliberately
    slow stream, or a WebSocket flood,
    **When** it is read,
    **Then** the renderer fails closed with a stable error code, memory stays
    within the budget, and the page still answers input within the
    interaction budget.

11. **Given** props with `__proto__`, `constructor` or `prototype` keys, values
    designed to leak data through CSS, or a document that tries to overlay the
    page,
    **When** they are rendered,
    **Then** no global object is modified, no request leaves the page, and
    nothing generated escapes its element's bounds.

12. **Given** a live local model and a set of injection prompts,
    **When** each runs several times,
    **Then** the result reports how often the model tried to emit something
    forbidden, and that none of it reached the page.

13. **Given** the same corpus against each contender,
    **When** it runs,
    **Then** each outcome is recorded per contender as blocked, rendered inert, or
    executed. A contender's outcome is reported, never failed in our CI.

**Running and showing**

14. **Given** a pull request,
    **When** CI runs,
    **Then** a short ladder and the attack corpus run against the budgets. A
    regression beyond the stated tolerance against the last `main` result
    fails the check.

15. **Given** the nightly schedule,
    **When** it runs,
    **Then** the full ladders on both profiles, the soak, the comparison and the
    attacks run, and their results are stored with a schema version.

16. **Given** a stored result,
    **When** the dashboard opens it,
    **Then** it shows the break points, curves per dimension, desktop against
    phone, and attack outcomes. Each number links to its workload, and the
    command to reproduce it is shown.

### Edge Cases

- **A contender's dependency fails to install or changes its API**: the
  comparison records that contender as unavailable for that run; the rest
  proceeds.
- **The machine is noisy (a CI runner)**: pull-request checks compare with the
  last `main` result, with a tolerance, rather than with absolute numbers. Headline
  results come from a named, fixed machine.
- **A step never finishes** (a renderer hangs): a per-step timeout ends it,
  and the step is recorded as broken by timeout.
- **The local model is unavailable**: the red-team is skipped and reported as
  skipped, not passed.
- **A contender turns out to execute an attack**: the outcome is recorded
  privately, and the result is withheld from the public dashboard until its
  maintainers have been told and have had a reasonable time to respond.
- **A workload breaks on the first step**: the break point is reported as
  "below the first step", and the ladder's first step is the place to look.

---

## Requirements

Numbered from 401, so they cannot be confused with features 001 to 003.

### Functional

**Workloads**

- **FR-401**: Workloads MUST be generated from a seed, so that the same seed
  produces the same documents and the same frame sequence on any machine.
- **FR-402**: Heavy visuals MUST be added through a bench-only extension of
  the standard contract. The standard twelve MUST NOT change.
- **FR-403**: Each workload MUST vary one dimension at a time: node count,
  depth, table cells, chart points, density of tone and colour, frames per
  second, rate of text change, heavy visual size.
- **FR-404**: Every renderer under test MUST receive the same document and the
  same sequence of frames for a step.

**Measurement**

- **FR-410**: Each step MUST record:
  - time to first node and to complete;
  - frame time while streaming (median, 95th and 99th percentile);
  - long tasks (count and longest);
  - interaction latency for a scripted interaction;
  - heap after garbage collection;
  - DOM node count;
  - transferred script size.
- **FR-411**: A step MUST be marked broken when any budget is exceeded:
  - a frame interval at the 95th percentile over 25 ms, meaning frames are
    dropped at 60 fps (revised in planning; see below);
  - a long task over 50 ms;
  - interaction latency over 200 ms;
  - a wrong or missing node;
  - a timeout.
- **FR-412**: A ladder MUST stop at its first broken step and report the last
  passing step as the break point, with the budget that broke.
- **FR-413**: Every ladder MUST run on a desktop profile and on a phone profile
  with the CPU slowed by a declared factor.
- **FR-414**: Each step MUST be repeated enough times to report a median and a
  spread, after a warm-up.
- **FR-415**: The soak MUST run for 30 minutes on the nightly schedule. It
  breaks on heap growth over 10%, or on any growth in detached DOM nodes,
  listeners or mounted components.

**Comparison**

- **FR-420**: The comparison MUST include:
  - json-render (React);
  - A2UI (its Lit, Angular and React renderers);
  - OpenUI Lang (React);
  - a Vercel AI SDK `useObject` baseline with hand-written components;
  - this SDK in every host.
- **FR-421**: Contenders MUST be compared on equal terms:
  - each component draws identical markup and styles;
  - each contender uses its own streaming path;
  - each runs in its own page;
  - versions are pinned and recorded with the result.
- **FR-422**: A workload a contender cannot express MUST be reported as "not
  expressible" with the reason.
- **FR-423**: Each result MUST record the machine, the browser version, the
  profile and the commit.

**Security**

- **FR-430**: A script-injection corpus, and fuzzed variants of it, MUST be run
  through every text and URL prop of every component, every connector, both
  validation tiers and every host. It succeeds against this SDK only if no
  script runs, no policy violation fires, and no forbidden element, attribute
  or URL appears.
- **FR-431**: Protocol and denial-of-service abuse MUST be run, and the
  renderer MUST fail closed with a stable error code, within the memory and
  interaction budgets. The abuse covers:
  - malformed, out-of-order, duplicated and truncated frames;
  - oversized frames;
  - slow-drip streams;
  - very large and very deep documents;
  - key collisions;
  - WebSocket floods.
- **FR-432**: These injection tricks MUST be run, and none may modify a
  global, send a request, or escape the element's bounds:
  - prototype-pollution keys;
  - values designed to leak data through CSS;
  - overlay attempts;
  - policy-bypass attempts.
- **FR-433**: A red-team MUST run injection prompts against a live local model
  several times each. It MUST report the attempt rate, and confirm zero
  forbidden output rendered.
- **FR-434**: Every attack outcome MUST be classified as blocked, rendered
  inert, or executed. Any "executed" or forbidden output in this SDK MUST fail
  the suite. Contenders' outcomes MUST be reported and MUST NOT fail this
  repository's CI.
- **FR-435**: A finding that a contender executes an attack MUST NOT be
  published until its maintainers have been told.

**Running**

- **FR-440**: Every pull request MUST run a short ladder and the
  script-injection, protocol and injection-trick suites. A regression beyond a
  stated tolerance against the last `main` result MUST fail the check.
- **FR-441**: A nightly job MUST run the full ladders on both profiles, the
  soak, the comparison and all attack suites, and store the results.
- **FR-442**: Results MUST be stored as JSON with a schema version.
- **FR-443**: One command MUST reproduce any stored result locally.

**Showcase**

- **FR-450**: A dashboard MUST show:
  - break points per renderer, dimension and profile;
  - the curve for each ladder;
  - soak trends;
  - attack outcomes.
  Each number MUST link to its workload.
- **FR-451**: The README and the comparison document MUST carry a summary
  table and link to the dashboard.
- **FR-452**: Every published figure MUST name the machine, the date and the
  versions it came from.

### Non-Functional

- **NFR-401**: Benchmark code and contender packages MUST NOT be part of any
  published package.
- **NFR-402**: The pull-request run MUST take at most 10 minutes; the nightly
  run at most 120.
- **NFR-403**: No suite may contact a host other than the machine it runs on.
  Contenders are installed ahead of time, and the model is local (Constitution
  I).
- **NFR-404**: The comparison MUST be reproducible within the reported spread
  on the same machine.
- **NFR-405**: No optimisation may be applied to this SDK for the benchmark that
  is not in the shipped packages.

### Key Entities

- **Workload**: a seed, a dimension, its ladder of steps, and the contract it
  needs.
- **Step**: one size of load, its document and frame sequence.
- **Profile**: desktop, or phone with a declared CPU slowdown.
- **Budget**: a metric, a limit, and whether exceeding it breaks a step.
- **Run**: a step rendered by one renderer on one profile, repeated.
- **Break point**: the last passing step of a ladder, and the budget that
  stopped it.
- **Contender**: a renderer, its version, and the adapter that feeds it.
- **Attack**: a payload or abuse, where it is placed, and the expected safe
  outcome.
- **Attack outcome**: blocked, rendered inert, or executed, with the evidence.
- **Result**: all of the above for one run of a suite, with machine, browser,
  commit and schema version.

---

## Planning revisions

| Item | First written | Revised | Reason |
|---|---|---|---|
| FR-411, clarification "what counts as breaking" | 95th-percentile frame time over 16.7 ms | 95th-percentile frame **interval** over 25 ms (1.5 refresh intervals at 60 Hz) | The harness self-test found an idle page measures 16.8 ms: frame intervals jitter around the 16.67 ms refresh, so the first wording fails a page doing nothing. A missed refresh shows as an interval near 33 ms; 25 ms separates the two. Same intent, no dropped frames at 60 fps, now measurable. Changed before any result existed ([budgets](./contracts/budgets.md), v2) |

---

## Constitution impact

None expected. Checked against each principle:

- **I**: the red-team uses a local model only, and no suite contacts another
  host.
- **IV**: the attack suites add evidence for the existing controls; nothing is
  relaxed. The test-only contract raises budgets inside the benchmark only.
- **V**: contenders and tools are development dependencies of an unpublished
  package.
- **VII**: budgets are stated before any result is seen, and every attack
  asserts the refusal.

---

## Out of Scope

- Load testing the server route (requests per second, concurrent
  generations). This feature measures rendering in the browser. Server load
  is a separate feature if wanted.
- Making contenders faster, or fixing their findings. Findings are reported to
  their maintainers.
- Interactive components and actions; the twelve remain read-only.
- Enforcing benchmark results as release gates beyond the pull-request
  regression check.
- Browsers other than Chromium for the comparison. Firefox and WebKit are a
  later addition.

---

## Success Criteria

- Every renderer has a stated break point per dimension, on desktop and phone,
  with the budget that set it.
- A 30-minute soak shows no unbounded growth in this SDK.
- Every attack in the corpus is blocked or rendered inert by this SDK, in every
  host and connector.
- The comparison is reproducible by one command, and the dashboard links each
  figure to its workload.
- A pull request that slows rendering beyond the tolerance, or lets an attack
  through, fails CI.

---

## Review Checklist

- [x] No implementation detail in requirements (libraries, file layout, APIs)
- [x] Every requirement is testable
- [x] Acceptance scenarios cover the refusal paths, not only the happy path
- [x] Ambiguities resolved in Clarifications; no markers remain
- [x] Scope explicitly bounded
- [x] Constitution impact identified before planning
