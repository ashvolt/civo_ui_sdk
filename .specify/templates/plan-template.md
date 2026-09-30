# Implementation Plan: [NAME]

**Branch**: `[nnn]-[slug]` | **Date**: [DATE] | **Spec**: [spec.md](./spec.md)
**Constitution**: [v[X.Y.Z]](../../.specify/memory/constitution.md)

---

## Summary

[Two paragraphs. The second should state the one insight the design turns on.]

---

## Technical Context

| | |
|---|---|
| **Language** | |
| **Runtime targets** | |
| **Dependencies** | |
| **Build** | |
| **Test** | |

---

## Constitution Check — pre-design

| Principle | Assessment | Verdict |
|---|---|---|
| I. Sovereignty is not a setting | | PASS/FAIL |
| II. The schema is the contract | | |
| III. Capability is negotiated | | |
| IV. Model output is untrusted | | |
| V. The edge is a target | | |
| VI. Spec precedes implementation | | |
| VII. Every behaviour has a test | | |

> A FAIL blocks Phase 0 until the design changes or the violation is recorded in
> Complexity Tracking with the simpler alternative that was rejected and why.

---

## Project Structure

```
[tree]
```

**Structure decision**: [why this shape, and what the rejected shape would have
made impossible to enforce]

---

## Design decisions

### D1 — [decision] → [ADR-000n](../../docs/adr/000n-slug.md)

[What, and the one-line reason. Alternatives live in the ADR.]

---

## Phase plan

### Phase 0 — Research → [research.md](./research.md)
### Phase 1 — Design → [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)
### Phase 2 — Tasks → [tasks.md](./tasks.md)
### Phase 3 — Implementation

---

## Constitution Check — post-design

| Principle | Evidence in the delivered design | Verdict |
|---|---|---|

### Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|

> An empty justification is a rejection, not a pass.

---

## Verification

| Gate | Command | Result |
|---|---|---|

---

## Known limitations

1. [limitation, and what would resolve it]

> A plan claiming no limitations is not a plan.
