# ADR-0005 — Classify validation issues instead of deriving a partial schema

**Status**: Accepted · **Date**: 2026-09-29 · **Principle**: II, VII

## Context

Mid-stream, the object is incomplete *by definition*: required keys have not
arrived, strings are three characters long, enum members are half-spelled. Running
the caller's schema unchanged rejects every frame until the last, which defeats
streaming.

## Decision

Run the real schema on every frame, then partition the issues:

- **pending** — "not written yet": missing required key, `too_small`, unresolved
  union, half-spelled enum, incomplete format, failed refinement. Tolerated while
  the stream is open.
- **fatal** — "wrong shape": `invalid_type` with a value present,
  `unrecognized_keys`, `too_big`. Fatal immediately.

`safeParsePartial(schema, value, finished)` promotes every pending issue to fatal
when `finished` is true. One schema, two meanings of "valid".

## Alternatives considered

**Derive a deep-partial schema.** The obvious approach. Rejected:
`.deepPartial()` was removed in Zod 4, so it must be hand-rolled by walking
Zod's internals and rebuilding every node; it breaks on refinements, transforms,
branded types and discriminated unions; and the walk differs between majors,
colliding with the requirement to support both. A large, fragile surface for a
problem with a smaller solution.

**Ask the user for two schemas, strict and loose.** Rejected: violates Principle
II outright — two schemas that must agree and will not.

**Validate only at completion; render unvalidated partials.** Rejected: gives up
failing fast. A wrong-typed field detected on token 4 should not cost the
remaining 2,000 tokens. It also means unvalidated data reaches the renderer,
which ADR-0004 exists to prevent.

**Validate structurally against the derived JSON Schema instead of Zod.**
Rejected: a second validator with subtly different semantics from the one the
caller wrote.

## Consequences

**Good**
- The caller writes one schema, with refinements and transforms intact.
- Fail-fast is preserved: a fatal issue aborts the upstream generation.
- It turned out **version-agnostic for free**: the classifier reads only
  `issue.code` and whether the input was `undefined`, which Zod 3 reports as
  `received: "undefined"` and Zod 4 as `input: undefined`. One helper covers both.
- No Zod internals are touched, so a future major cannot break it.

**Bad**
- The classification is a heuristic over issue codes. A custom refinement that
  *should* fail immediately is treated as pending until the stream closes — it
  still fails, just later.
- Validation runs on every frame rather than once. Bounded by `frameIntervalMs`
  and by document size; a no-op when the parsed value is unchanged.

## Verification

`generate.test.ts` asserts that missing required keys are tolerated for most of a
stream and that a wrong-typed value aborts mid-stream with no `complete` frame.
