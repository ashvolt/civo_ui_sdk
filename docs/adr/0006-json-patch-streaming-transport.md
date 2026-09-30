# ADR-0006 — Stream JSON Patch frames, not snapshots

**Status**: Accepted · **Date**: 2026-09-29 · **Principle**: V (NFR-008)

## Context

Successive partial parses of a streaming document differ by very little — usually
a few characters appended to one string. Sending the whole object per frame costs
bandwidth quadratic in document size: a 40 KB dashboard spec over 500 frames is
megabytes, much of it over a mobile connection.

## Decision

Each frame carries a **JSON Patch** (RFC 6902 subset: `add`, `replace`, `remove`)
computed by diffing the current parse against the last emitted value. Paths are
RFC 6901 pointers.

Escape hatches:
- `transport: "snapshot"` sends full documents, for debugging;
- a patch larger than the document it describes is automatically sent as a
  snapshot instead;
- an off-stream repair always sends a snapshot.

## Alternatives considered

**Snapshot per frame.** Simplest, O(n²) bytes. Rejected on NFR-008, but retained
as an option because it is genuinely easier to debug.

**Full RFC 6902 including `move`, `copy`, `test`.** Rejected: a document that
grows monotonically never needs them, and every op we ship is one a reviewer has
to be able to check by eye.

**Character-level text deltas (append-only).** Smallest possible frames. Rejected:
it only works if the client re-parses, which means shipping the parser to the
browser and giving up ADR-0001.

**A custom binary delta format.** Rejected: unreadable in devtools. Being able to
see what the server sent, without a decoder, has repeatedly been worth more than
the bytes.

**Keyed array diffing.** Rejected for v1: a model appends to a list far more often
than it splices into one, so positional diffing is minimal for the common case and
merely non-minimal for the rare one.

## Consequences

**Good**
- Bandwidth linear in document size.
- `applyPatch` shares untouched subtrees structurally, so React consumers keep
  referential equality on branches that did not change and skip re-rendering.
- Frames are human-readable JSON in the network panel.

**Bad**
- `seq` must be strictly gapless, because a patch assumes the exact document the
  server held. The accumulator throws on a gap rather than render a mixture — a
  deliberate choice, documented in the protocol contract.
- A mid-list insert produces a larger patch than a keyed diff would.
- Diff + apply is more code than `value = latest`. Covered by round-trip tests.

## Verification

`json-patch.test.ts` asserts the round-trip invariant over a realistic streaming
sequence, array append and truncate ordering, structural sharing by reference
identity, and root-type replacement. `react/stream.test.ts` asserts the
accumulator refuses an out-of-order `seq`.
