# ADR-0001 — Parse, validate and guard model output on the server

**Status**: Accepted · **Date**: 2026-09-29 · **Principle**: IV, and it is what makes IV enforceable

## Context

Generative UI needs model output turned into a validated component tree. That
work — extract JSON from whatever wrapper the model used, repair the partial
document, validate it against a schema, guard URLs and component types — has to
happen somewhere.

The dominant pattern in the ecosystem (the Vercel AI SDK's `streamObject`, most
chat UIs) streams raw model tokens to the browser and parses them there.

## Decision

Parsing, validation and guarding happen **on the server**. The browser receives a
typed event stream describing a validated object taking shape, never model tokens.

## Alternatives considered

**Raw token passthrough.** One less hop of latency. Rejected: the browser would
have to parse, validate and guard, and all three would then run in an environment
the attacker controls — a motivated user can edit the client, so a client-side
allowlist is advice, not a control. It also means every application
re-implements the pipeline, and they will not all get the escape-sequence rewind
right.

**Both: validate server-side, stream tokens anyway for a "typewriter" effect.**
Rejected as the worst of both — two representations of the same document that can
disagree, and the tokens are still a channel for unvalidated content.

**Client-side validation only, server as a dumb proxy.** Rejected: the server
already holds the schema (it needed it to build the request), so validating there
is nearly free, and it is the only place a validation result can be trusted.

## Consequences

**Good**
- One trust boundary, in code the attacker cannot edit.
- The React package needs no knowledge of relaxAI, no API key, and no model id.
- A schema violation can abort the upstream generation on the fourth token
  instead of the four-thousandth.
- The wire protocol becomes a stable, versioned contract — a non-React client is
  a small amount of work.

**Bad**
- One extra hop of latency per frame. Measured in the reference app as
  indistinguishable from the model's own inter-token latency.
- Server CPU spent parsing. Bounded by the document budget.
- A "raw text streaming" use case is not served. Out of scope: this SDK is about
  structured UI.

## Verification

`generate.ts` is server-only; `packages/react` contains no parser. `readUIStream`
drops frames that are not well-formed SDK events. The route tests assert that a
failure after the stream opens arrives as an in-band `error` frame.
