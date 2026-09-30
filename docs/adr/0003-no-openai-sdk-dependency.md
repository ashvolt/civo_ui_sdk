# ADR-0003 — Write the HTTP client rather than depend on `openai`

**Status**: Accepted · **Date**: 2026-09-29 · **Principle**: I, V

## Context

relaxAI is OpenAI-compatible, and Civo's own documentation shows the `openai`
package pointed at `https://api.relax.ai/v1`. Reusing it is the obvious move.

## Decision

Implement a minimal `fetch`-based client in core (~230 lines of client plus ~230
of HTTP) and take no HTTP dependency.

## Alternatives considered

**Depend on `openai`.** Rejected for three reasons, in order of weight:

1. **It assumes OpenAI's capability set.** Its types and request builders are
   shaped for a provider where `response_format: json_schema` always works. The
   ladder (ADR-0002) is not expressible through it without fighting it.
2. **It defeats Principle I.** The pitch of this SDK is a controlled egress path
   the buyer can audit. Vendoring a large HTTP client with its own retry policy,
   its own timeout semantics and its own transitive dependencies puts code we did
   not write on the path every prompt travels.
3. **Weight and portability.** It brings a second retry implementation and
   platform-specific shims into a bundle we want to run unchanged on Workers.

**Depend on a thin OpenAI-compatible client (e.g. an `openai-edge`-style
wrapper).** Rejected: the maintained ones are unmaintained and the unmaintained
ones are smaller than what we wrote.

**Use `undici` directly for better control.** Rejected: a `node:`-adjacent
dependency, which Principle V forbids in core.

## Consequences

**Good**
- Zero runtime dependencies in core. The full egress path is auditable in an
  afternoon.
- The same build runs on Node, Edge, Workers, Bun and Deno.
- Retry, timeout and abort semantics are ours, so `timeout` (retryable) and
  `aborted` (not) are distinguishable — something a wrapped client obscures.
- `fetch` is injectable, so the whole suite runs against real code with no
  network.

**Bad**
- We maintain retry, backoff, SSE decoding and error mapping ourselves. Mitigated
  by these being small, and tested.
- We do not get new OpenAI endpoints for free. Acceptable: this SDK targets
  `/chat/completions` and `/models`.

## Verification

`packages/core/package.json` has no `dependencies` key; CI asserts it. No `node:`
import appears in `packages/core/src`; CI greps for it.
