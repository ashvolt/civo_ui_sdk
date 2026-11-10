# Contract — Budgets

Fixed **before** any result exists (Constitution VII, plan D5). Changing a
value later needs a pull request that says why, and keeps the old result
comparable by recording the budget version with every result.

**Budget version**: 2

| Version | Change | Why |
|---|---|---|
| 1 | as first written | |
| 2 | frame budget: the 95th-percentile frame interval must not exceed **25 ms** (1.5 refresh intervals at 60 Hz) | Changed before any result existed. The harness self-test showed an **idle** page measuring a 95th-percentile interval of 16.8 ms: `requestAnimationFrame` intervals jitter around the 16.67 ms refresh, so "over 16.7 ms" fails a page doing nothing. A frame is late when it misses a refresh, i.e. its interval reaches about two refresh intervals; 1.5 is the midpoint. The intent, no dropped frames at 60 fps, is unchanged |

## What breaks a step (FR-411)

| Metric | Limit | Why this value |
|---|---|---|
| Frame interval, 95th percentile, while streaming | 25 ms | No dropped frames at 60 fps: an interval over 1.5 refresh intervals means a refresh was missed (v2) |
| Longest task (long animation frame) | 50 ms | The long-task threshold browsers and web-vitals use |
| Interaction latency (scripted scroll and click) | 200 ms | The "good" INP threshold |
| Correctness | every node present and equal to the expected document | A fast wrong answer is not a pass |
| Step timeout | 60 s desktop, 180 s phone | A hang is a break, not a missing number |

## What breaks the soak (FR-415)

| Metric | Limit |
|---|---|
| Heap growth after forced garbage collection, first to last 5 minutes | 10% |
| Detached DOM nodes at the end | 0 growth |
| DOM nodes and event listeners at the end, against the first steady minute | 0 growth beyond the document's own size |
| Mounted framework components | equal to the nodes on the page |

## Protocol abuse (FR-431)

| Metric | Limit |
|---|---|
| Heap during an abuse case | at most 2× the heap of the same page idle |
| Interaction latency during an abuse case | 200 ms |
| Time to fail closed after the bad frame | 1 s |

## Pull-request regression tolerance (FR-440)

A metric regresses if its median is worse than the stored `main` median by more
than **20% or 2 ms, whichever is larger**. Memory uses 10%.
