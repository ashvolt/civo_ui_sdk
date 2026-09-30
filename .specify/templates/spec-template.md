# Feature Specification: [NAME]

**Feature Branch**: `[nnn]-[slug]`
**Created**: [DATE]
**Status**: Draft
**Input**: "[the original request, verbatim]"

> Write *what* and *why*. Technology choices belong in `plan.md`.
> Mark every ambiguity `[NEEDS CLARIFICATION: question]` rather than guessing —
> an unresolved marker blocks `/plan`.

---

## Clarifications

### Session [DATE]

- Q: [question] → **A: [answer].** (Drives FR-0xx.)

*State explicitly when no markers remain.*

---

## User Scenarios & Testing

### Primary User Story

[A named person, their job, the constraint they are under, and what is hard
*today*. Name the friction, not the feature.]

### Acceptance Scenarios

1. **Given** [state], **When** [action], **Then** [observable outcome].

> Cover the refusal paths, not only the happy path. A spec whose scenarios are
> all successes has not been thought through (Constitution VII).

### Edge Cases

- **[condition]**: [required behaviour]

---

## Requirements

### Functional

- **FR-001**: The system MUST [testable behaviour].

### Non-Functional

- **NFR-001**: [constraint, with the number that makes it checkable]

### Key Entities

- **[Entity]** — [what it is, and the invariant it carries]

---

## Out of Scope

- [thing], because [reason]

---

## Success Criteria

- [Measurable outcome a reviewer could verify without reading the code]

---

## Review Checklist

- [ ] No implementation detail in requirements
- [ ] Every requirement is testable
- [ ] Refusal paths covered in acceptance scenarios
- [ ] No `[NEEDS CLARIFICATION]` markers remain
- [ ] Scope explicitly bounded
- [ ] Traceable to the constitution's principles
