# Tasks: [NAME]

**Feature**: `[nnn]-[slug]`
**Input**: [plan.md](./plan.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

`[P]` marks tasks with no dependency on each other that may run in parallel.
Per Constitution Principle VII, a test task precedes the implementation it covers
and must fail before that implementation exists.

**Status legend**: `[x]` done · `[ ]` outstanding

---

## Phase A — Foundation

- [ ] **T-001** [task]

## Phase B — [area]

- [ ] **T-00n** Tests for [unit]: [the specific cases, including refusals]
- [ ] **T-00n+1** [unit] implementation

---

## Outstanding

- [ ] **T-0xx** [task] — **Blocked**: [what is blocking it, and what a wrong
  assumption costs in the meantime]

---

## Dependency order

```
A ─► B ─► C
```

## Parallel batches actually used

- **T-00a, T-00b** — [why independent]

## Verification gate

```bash
pnpm verify
[any project-specific greps that enforce a constitutional principle]
```
