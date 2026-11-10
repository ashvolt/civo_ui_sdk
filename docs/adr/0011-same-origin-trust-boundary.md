# ADR-0011 — Same origin is the only boundary for skipping browser validation

**Status**: Accepted · **Date**: 2026-11-10 · **Principle**: IV
**Feature**: [003-pluggable-generative-ui](../../specs/003-pluggable-generative-ui/spec.md) · research R4, R7

## Context

Features 001 and 002 validated everything on the server (ADR-0001), and the
browser re-checked only the finished object. Feature 003 adds sources that
never pass through this SDK's server: static documents, streams from other
services, WebSockets. Constitution IV, as amended, requires a foreign document
to be validated in full in the browser.

Full validation costs Zod and the contract, about 17 KB gzip. A page reading
only its own route should not pay that for a check its server already made. So
the browser has to decide when it may skip the check, and it has to decide
without being fooled.

## Decision

Browser validation is **full by default** and may be skipped only when both
hold:

1. the source is an **http(s) URL on the page's own origin**, and
2. the host asks for it explicitly: `validate: "server"`.

`resolveValidation(source, requested)` in `relax-ui-protocol` makes the decision
for every renderer. Asking for `server` with any other source (another
origin, a document, a stream, a socket) is `config_invalid`, raised before
anything is fetched or rendered. It is never silently upgraded to `full`.

In the server tier the validator's code is never loaded. In the full tier it is
loaded lazily, on the first node, and every node's props must pass it before an
implementation sees them.

## Alternatives considered

**Trust a header or a `meta` frame from the server.** Rejected: anything in the
response can be produced by whoever produced the response.

**Sign frames.** Rejected: verifying in the browser needs the key in the
browser, which is no key at all.

**Trust a URL pattern (`/api/ui`).** Rejected: a pattern says nothing about who
answers it. Another origin can serve the same path.

**Silently upgrade a refused `server` to `full`.** Safe, and rejected: it hides
the mistake from the developer who made it, who will then think validation is
off. A loud refusal teaches the boundary.

**Always validate.** Simplest and safest. Rejected as the only option: it
charges every same-origin page 17 KB to re-check its own server, and the
original `api` route has never paid that (NFR-206).

## Consequences

**Good**

- The boundary is the one thing a browser can check that the page cannot forge.
  If the same-origin server is compromised, the page is too, and validation would
  not have saved it.
- A page reading only its own route ships no validator. The Chromium test
  asserts Zod is never downloaded there, and is downloaded once for a page with
  foreign sources.
- `useGenerativeObject({ api })` keeps its behaviour: a same-origin `api` stays
  in the server tier. A cross-origin `api` with no schema is now refused. It
  used to run unvalidated, which was the bug this decision closes.

**Bad**

- **Same origin says who served a stream, not what produced it.** An application
  that proxies a third-party stream through its own origin and asks for `server`
  has turned validation off for foreign content. That is its choice, made in
  code, and the security model says so.
- **The server tier still re-checks output at render time** (the tag and
  attribute allowlists and the URL guard). So "no browser validation" means no
  schema validation, not no checks. That is deliberate, and it is easy to
  misread.
- `file:` pages and sandboxed frames have no origin. There, only a relative URL
  counts as same-origin.

## Verification

- `packages/protocol/test/trust.test.ts`: every source kind against both tiers;
  protocol-relative and look-alike URLs refused.
- `packages/element/test/element.test.ts`: the element's refusal table. Nothing
  is fetched, listened to or rendered after a refusal, and the server tier never
  calls the validator loader.
- `packages/react/test/generation.test.ts`: the hook's legacy `api` behaviour and
  the cross-origin refusal.
- `examples/html-host/e2e/html-host.spec.ts`: Zod is never fetched for the
  same-origin route, and fetched once for the page that validates.
