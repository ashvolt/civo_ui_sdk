# Contract — Budgets

Fixed **before** any result exists (Constitution VII, plan D5). Changing a
value later needs a pull request that says why, and keeps the old result
comparable by recording the budget version with every result.

**Budget version**: 1

## What breaks a step (FR-411)

| Metric | Limit | Why this value |
|---|---|---|
| Frame time, 95th percentile, while streaming | 16.7 ms | One frame at 60 fps |
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
