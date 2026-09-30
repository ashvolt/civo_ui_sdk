# ADR-0004 — Close the component vocabulary at schema-construction time

**Status**: Accepted · **Date**: 2026-09-29 · **Principle**: II, IV

## Context

A generated UI document names components. The model choosing those names has read
retrieval context, user text and tool output — none of it trusted. Generative UI
therefore moves the XSS surface from "what the developer wrote" to "what the model
was persuaded to write".

## Decision

The application registers a `ComponentSpecMap`. From that one declaration the SDK
derives:

- a recursive **discriminated union** whose `type` literals are exactly the
  registered names;
- the JSON Schema sent to relaxAI;
- the server-side validator;
- the renderer's lookup table;
- the document's node/depth budget.

A component the application did not register has **no branch** in the union, so a
document naming it fails validation. The renderer then refuses it again.

Prop schemas are per-component and `.strict()`. URL-bearing props go through
`urlString()`, which guards at *validation* time.

## Alternatives considered

**A general HTML-element vocabulary** (`{tag, attrs, children}`). Maximum
expressiveness. Rejected: it is an XSS engine with a JSON interface. Every
attribute becomes a sink to audit, and `onerror` is one hallucination away.

**Sanitise generated HTML with DOMPurify.** Rejected: a runtime dependency in
core, a denylist where we can have an allowlist, and it still permits any element
the sanitiser allows rather than only the ones the application ships.

**Runtime allowlist check at render only.** Rejected: the model is never told what
is legal, so it wastes generations on components that will be dropped, and the
check runs in the browser where it can be edited.

**Validate types but not props.** Rejected: `<Metric value={{...}}/>` with a
wrong-typed prop is a crash, and a prop spread onto a DOM element is a sink.

## Consequences

**Good**
- The security property follows from the construction, not from a check somebody
  might forget.
- The model is *told* the vocabulary, so output quality improves — component
  `description`s are the largest single lever we found.
- One declaration, four consumers: nothing to keep in sync (Principle II).
- `.strict()` means an unexpected key fails loudly rather than being silently
  dropped — and silently dropped is how something later gets silently spread.

**Bad**
- The model cannot invent a component. That is the point, but it does mean a new
  visual requires a code change; a fully dynamic design tool is not a use case
  this serves.
- `z.discriminatedUnion` requires ≥2 members, so the single-component case is
  special-cased.
- Heterogeneous specs needed a type-system solution to stay `any`-free — see
  [LLD §10.2](../lld.md#102-the-type-system-problem-worth-recording).

## Verification

`ui-contract.test.ts` asserts rejection of: an unregistered component, wrong-typed
props, extra props, a `javascript:` href, control characters in text, node-count
and depth budgets, and children-policy violations. `renderer.test.tsx` asserts the
renderer independently refuses all of them, escapes model text, and has no
raw-HTML path. CI greps for `dangerouslySetInnerHTML`.
