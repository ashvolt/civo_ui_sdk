# ADR-0009 — A hand-written reconciler, built on the protocol's structural sharing

**Status**: Accepted · **Date**: 2026-11-10 · **Principle**: IV, V, VII
**Feature**: [003-pluggable-generative-ui](../../specs/003-pluggable-generative-ui/spec.md) · research R2

## Context

`<gen-ui>` has to render generated documents in any host — plain HTML, Angular,
Vue — so its renderer cannot be React. It has to update a document many times a
second while it streams, keep what has not changed (focus, selection, a running
transition), load component code lazily, and also drive framework components
from React, Angular and Vue (ADR-0012).

The SDK already has one property that makes this much easier than general
virtual-DOM diffing. `applyPatch` shares structure: a subtree no patch touched
is the **same object** in the next document (ADR-0006).

## Decision

Write the renderer, in two parts, with no dependency:

- A **resolver** that decides, per node and independently of drawing, what a
  document shows. Is the node too deep, or not a contract type? Start loading
  its code the moment its exact type name arrives. Validate its props by tier.
  Then render, show a placeholder, or report. React, the DOM backend and every
  connector use it, so they cannot disagree.
- A **DOM backend** whose reconciliation is mostly identity checks:
  - the same node object with nothing pending below it skips its subtree;
  - the same props object keeps its element and reconciles only its children;
  - new props re-run the template and patch the element in place, so a
    streaming string updates one text node;
  - children are matched by the model's `key`, else by type and position.

Output safety is enforced in the backend, independent of templates: a tag
allowlist, an attribute allowlist, the URL guard again, and text that is only
ever a text node.

## Alternatives considered

**Lit** (~5–6 KB). Good, small, and the original fallback. Rejected because it
would sit between the resolver and the framework mounts (ADR-0012) without
removing a layer. Its templates also solve a problem the renderer does not
have: templates here are data, not tagged literals.

**Preact plus a custom-element wrapper.** Rejected: a second React-like runtime
on pages that may already run React, Angular or Vue.

**Reuse React for the element.** Rejected: an Angular or Vue page would pay for
React to show a card.

## Consequences

**Good**

- The render core is 3.8 KB gzip, and a page with the lazy base theme is
  4.1 KB, against an estimate of 5–6 KB for Lit alone.
- One resolver for every renderer, so a validation, depth or lazy-loading rule
  is implemented once.
- Mounting framework components needed no change to the reconciler's structure,
  only a second kind of implementation.

**Bad**

- **A hand-written reconciler is where subtle bugs live.** Mitigated as feature
  001 mitigated its partial parser, with property tests. Two related risks are
  only covered by those tests: an identity skip that is wrong (a node "pending
  below" not marked) or a key collision. A deliberate bug of each kind was
  caught; bugs nobody has thought to introduce are not.
- **It only stays this simple while documents share structure.** A source that
  sends a fresh snapshot every frame forces a re-render of every template.
  The output is still correct, but slower. All of the SDK's own sources patch.
- Maintenance is ours. Lit would have brought fixes from upstream; this brings
  none.

## Verification

- `packages/render/test/reconcile.test.ts`: three realistic documents, each
  streamed two characters at a time in both validation tiers. After every
  frame the DOM must equal a fresh render of that frame, and unchanged nodes
  must be the same DOM objects. Mutations to text patching, key matching and
  the waiting check were each caught.
- `packages/element/test/element.test.ts`: the same property inside
  `<gen-ui>`, over a WebSocket and over SSE with chunk boundaries at arbitrary
  bytes (T-240).
- `packages/render/test/bundle.test.ts`: a page that renders nothing contains
  no component code.
