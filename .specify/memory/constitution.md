<!--
Sync Impact Report
==================
Version change:      (none) -> 1.0.0
Ratified:            2026-09-29
Rationale:           Initial ratification. MAJOR because this establishes the
                     governing principles for the repository from nothing.

Principles defined:
  I.   Sovereignty Is Not A Setting
  II.  The Schema Is The Contract
  III. Capability Is Negotiated, Never Assumed
  IV.  Model Output Is Untrusted Input
  V.   The Edge Is A Target, Not An Afterthought
  VI.  Specification Precedes Implementation
  VII. Every Behaviour Has A Test That Would Fail Without It

Templates requiring update:
  ✅ .specify/templates/spec-template.md    — aligned, Constitution Check present
  ✅ .specify/templates/plan-template.md    — aligned, gates reference I-VII
  ✅ .specify/templates/tasks-template.md   — aligned, TDD ordering enforced
  ✅ docs/hld.md                            — Principle mapping section added
  ✅ docs/lld.md                            — Principle mapping section added

Follow-up TODOs: none
-->

# relaxAI Generative UI SDK — Constitution

## Purpose

This repository builds `@civo/relax-ui-*`: a TypeScript SDK that turns Civo's
relaxAI into a safe, plug-and-play backend for **Generative UI** — interfaces
whose structure is decided at request time by a model rather than at build time
by a developer.

The constitution binds every specification, plan, task and line of code in this
repository. Where a downstream document disagrees with it, the constitution
wins and the downstream document is the bug.

## Core Principles

### I. Sovereignty Is Not A Setting

relaxAI's reason to exist is jurisdictional: inference runs in UK data centres,
and prompts do not leave them. An SDK that quietly permits an arbitrary
`baseURL`, ships a telemetry beacon, or reaches a third-party CDN at runtime
hands that guarantee back without the buyer noticing.

Therefore:

- The transport MUST refuse any endpoint host not explicitly allowlisted.
  `api.relax.ai` is the only default.
- Plaintext HTTP MUST be refused except for an explicitly opted-in loopback
  address in development.
- The SDK MUST NOT perform any network call the application did not ask for.
  There is no analytics endpoint, no version check, no error reporter.
- Observability MUST be delivered as in-process callbacks and counters. Anything
  that could carry a prompt, a completion or a user identifier off-process MUST
  be the application's explicit act, never the SDK's default.
- Redaction of outbound prompts MUST be available, MUST be deterministic, and
  MUST NOT involve a model.

*Rationale:* the customer is buying a compliance boundary. A library that
perforates it is worse than no library, because it looks like it helps.

### II. The Schema Is The Contract

One schema, authored once by the application, MUST be the single source of truth
for: the JSON Schema sent to the model, the runtime validator, the TypeScript
type, and the renderer's component lookup.

Therefore:

- A generation MUST return a value that has passed the caller's schema, or it
  MUST raise a typed error. There is no third outcome and no `any` escape.
- Derived artefacts (JSON Schema, prompt text, component vocabulary) MUST be
  computed from the schema, never maintained alongside it.
- Where derivation is impossible, the SDK MUST fail loudly and offer an explicit
  override, rather than emit an approximation that silently mis-describes the
  shape to the model.

*Rationale:* every duplicated schema is a future production incident whose root
cause is "the two copies drifted".

### III. Capability Is Negotiated, Never Assumed

relaxAI is 1:1 OpenAI-compatible at the protocol level. It is not OpenAI at the
*capability* level: the catalogue is open-weight models whose support for
constrained decoding, tool calling and reasoning traces varies by family and
changes as new models land.

Therefore:

- Model capability MUST be data — inspectable, overridable, and refined at
  runtime — never a hard-coded assumption in a request builder.
- The SDK MUST attempt the strongest structuring mechanism available and MUST
  degrade automatically when the server rejects it.
- A capability rejection observed once MUST be remembered for the process, so
  the cost is paid at most once.
- A degradation MUST be visible in the result metadata. Silent degradation is a
  debugging tax levied on the user.

*Rationale:* "works on the model I tested" is not a supported configuration when
the catalogue is the product.

### IV. Model Output Is Untrusted Input

A generated component tree is attacker-influenced data. Retrieval context,
user-supplied text and tool results all reach the model, and the model is not a
trust boundary.

Therefore:

- The set of renderable component types MUST be closed at schema-construction
  time. A model MUST NOT be able to name a component the application did not
  register.
- Props MUST be validated per-component before render.
- The renderer MUST NOT emit raw HTML from model output under any option.
- URL-bearing props MUST pass a scheme allowlist. `javascript:` and non-image
  `data:` URLs MUST be rejected at validation time, not at render time.
- Document size and depth MUST be bounded, and the bound MUST be enforced by an
  iterative walk that cannot itself be made to overflow the stack.
- Validation, guarding and parsing MUST happen on the server. What crosses to
  the browser is a vouched-for object, never raw model tokens.

*Rationale:* generative UI moves the XSS surface from "what the developer wrote"
to "what the model was persuaded to write". The allowlist is the mitigation.

### V. The Edge Is A Target, Not An Afterthought

Next.js route handlers run on Node, on the Vercel Edge runtime, on Cloudflare
Workers and in tests. A generative UI SDK that only works on one of them is not
a Next.js SDK.

Therefore:

- Core MUST depend on no platform API beyond `fetch`, `ReadableStream`,
  `TextEncoder`/`TextDecoder`, `AbortController` and `URL`.
- Core MUST have zero runtime dependencies other than the caller's own Zod.
- No `node:` import may appear in core. Node-only behaviour, if ever needed,
  belongs in an adapter package.
- Every I/O seam MUST be injectable, so tests exercise the real code path with a
  stub `fetch` rather than a mocked module.

*Rationale:* dependencies and platform assumptions are inherited by every
deployment target. Core is the wrong place to spend either.

### VI. Specification Precedes Implementation

This repository is developed with GitHub Spec Kit. Features move
**constitution → specify → clarify → plan → tasks → implement**, in that order.

Therefore:

- A feature MUST have a `spec.md` describing user-visible behaviour and testable
  acceptance criteria before a `plan.md` exists.
- A `plan.md` MUST pass an explicit Constitution Check, before and after design.
- Specs MUST describe *what* and *why*. Technology choices belong in the plan,
  and non-obvious ones belong in an ADR.
- Ambiguities MUST be marked `[NEEDS CLARIFICATION]` rather than guessed. An
  unresolved marker blocks `/plan`.

*Rationale:* the artefacts are the review surface. Code review of a 4,000-line
SDK cannot recover the intent the spec would have stated in a page.

### VII. Every Behaviour Has A Test That Would Fail Without It

Therefore:

- Contract tests for the wire protocol, the strategy ladder and the guards MUST
  exist and MUST be written to fail before the implementation lands.
- Parsers MUST be tested against every prefix of a realistic document, not a
  handful of hand-picked cases.
- Security properties (URL rejection, unknown-component rejection, depth limits)
  MUST have tests that assert the *refusal*, not just the happy path.
- A test that passes against an empty implementation is not a test.

*Rationale:* a partial-JSON parser and a capability ladder are exactly the kind
of code whose bugs appear only under inputs no human would think to type.

## Engineering Constraints

- **Language**: TypeScript in `strict` mode, `noUncheckedIndexedAccess` on.
  No `any` in exported signatures; `unknown` plus a narrowing guard instead.
- **Package boundaries**: `core` is runtime-agnostic; `react` may use React;
  `next` may use Web platform APIs but not `next` itself at runtime.
- **Errors**: every failure raised by the SDK is a `RelaxUIError` with a stable
  `code`. Callers branch on `code`, never on message text.
- **Public API**: exported from a package root barrel. Anything not exported
  there is internal and may change in a patch release.
- **Versioning**: semantic versioning. The wire protocol carries its own integer
  version, bumped independently of the package version.

## Development Workflow

1. `/constitution` — amend this document (rarely).
2. `/specify` — write `specs/<nnn>-<slug>/spec.md`.
3. `/clarify` — resolve every `[NEEDS CLARIFICATION]`.
4. `/plan` — produce `plan.md`, `research.md`, `data-model.md`, `contracts/`,
   `quickstart.md`. Constitution Check gates entry and exit.
5. `/tasks` — produce `tasks.md`: dependency-ordered, tests before implementation,
   `[P]` marking genuinely parallel work.
6. `/implement` — execute tasks in order.
7. `/analyze` — cross-check spec, plan, tasks and code for drift.

Pull requests MUST state which principles the change touches. A PR that weakens
a principle MUST amend this document in the same change, with the version bump
and rationale, or it MUST be rejected.

## Governance

- **Amendment**: a change to this document requires a PR that updates the Sync
  Impact Report, bumps the version, and propagates the change into the templates
  and any affected spec.
- **Versioning**: MAJOR for a removed or redefined principle; MINOR for a new
  principle or materially expanded guidance; PATCH for clarifications that
  cannot change a decision.
- **Compliance**: `/analyze` reports violations. An accepted violation MUST be
  recorded in the plan's Complexity Tracking table with the simpler alternative
  that was rejected and why. An empty justification is a rejection.

**Version**: 1.0.0 | **Ratified**: 2026-09-29 | **Last Amended**: 2026-09-29
