# ADR-0008 — Send a constrained decoder only what it can enforce

**Status**: Accepted · **Date**: 2026-10-05 · **Principle**: II, III
**Feature**: [002-provider-agnostic-inference](../../specs/002-provider-agnostic-inference/spec.md)

## Context

ADR-0002's ladder assumes an endpoint that cannot do something *says so*: a 4xx
whose message `isCapabilityRejection` recognises, and the SDK walks down a tier.

Ollama 0.35 does not always say so. Given `response_format: json_schema` with
the reference app's `Dashboard` schema it answers **200** and generates
unconstrained — props the schema forbids, prose after the document. Nothing is
logged. Bisecting the schema one keyword family at a time isolated the cause:

| Schema sent | Enforced? |
|---|---|
| full | no |
| without `$schema` | no |
| without `pattern` | **yes** |
| without `$schema`, `pattern` | yes |

One keyword defeats the grammar compiler, and the fallback is to drop the
grammar rather than the request. Recursion, `anyOf`, `const`, `default` and
`maxLength` are all fine.

Measured through the whole pipeline, same prompt, three seeds per cell:

| Model | Schema sent | Completed |
|---|---|---|
| qwen2.5:3b | adapted (no `pattern`) | 3 / 3 |
| qwen2.5:3b | as authored | 0 / 3 |
| llama3.2:3b | adapted (no `pattern`) | 3 / 3 |
| llama3.2:3b | as authored | 0 / 3 |

The `pattern` in question is not exotic. It is the control-character guard
emitted by the SDK's own `displayText()` helper — a Principle IV control present
in essentially every UI registry.

## Decision

A provider profile may declare a **schema dialect**: the JSON Schema keywords
its constrained decoder cannot honour. For server-enforced tiers
(`native_json_schema`, `tool_call`) the SDK sends a **wire schema** derived by
omitting those keywords.

Four constraints make that safe:

1. **The validator does not change.** The application's schema validates every
   frame and the final document, exactly as before. Adaptation changes what the
   model is told, never what is accepted.
2. **It only removes.** No keyword is rewritten or approximated. Anything the
   full schema accepts, the wire schema accepts.
3. **It is structure-aware.** `pattern` is removed where it is a keyword and
   kept where it is a property *name* under `properties` or `$defs`, or data
   under `const`/`enum`/`default`.
4. **It is reported.** A `schema_adapted` trace event names the provider and the
   dropped keywords, on every generation it applies to.

The prompted tier is exempt: there the schema is read by the model, not compiled
by the server, so nothing is gained by telling it less.

## Alternatives considered

**Detect the silent failure and downgrade.** The symmetrical fix: notice that a
"constrained" tier produced an unconstrained document, mark the tier unsupported,
retry lower. Rejected as the *primary* mechanism: detection happens only after
the bad tokens are generated — and mid-stream, after some are painted — so it
costs a whole generation to learn what the profile could have known for free.
It also discards a tier the endpoint can serve perfectly well.

**Drop `pattern` for every provider.** One code path. Rejected: it throws away
real enforcement on servers that implement the keyword, to accommodate one that
does not.

**Stop emitting `pattern` from `displayText()`.** Rejected: the guard it
expresses is a security control, and JSON Schema is where it is described to
servers that can enforce it.

**Translate `pattern` into something the grammar can express.** Rejected: an
approximation is exactly what Principle II forbids, and a subtly different
regular language enforced server-side is worse than none — it fails in ways the
validator's error messages do not explain.

**Refuse to use the constrained tier when the schema has an unsupported
keyword.** Fails loudly, as Principle II prefers. Rejected because the loud
failure is permanent: it would put every local generation on the tool tier,
which Ollama delivers as a single chunk (research R4) — no streaming at all.

## Consequences

**Good**

- Local generation went from never completing to completing, on both bench
  models, with nothing else changed.
- The constrained tier is usable locally, and it is the only local tier that
  streams incrementally: hundreds of frames instead of one.
- The mechanism is data. Supporting another runtime's quirk is a line in a
  profile, not a branch in a request builder.

**Bad**

- **The model is told less than the validator enforces.** A string the dropped
  `pattern` would have prevented can now be generated, and is caught by the
  validator *after* the tokens are spent rather than prevented before. For
  `displayText`'s control-character guard that is rare in practice; for a schema
  whose `pattern` carries real structure (a date format, an identifier shape) it
  would mean more repair rounds on this provider than on one that enforces it.
- **This is a recorded tension with Principle II**, which says the SDK must not
  "emit an approximation that silently mis-describes the shape to the model".
  The wire schema is a looser description. It is derived, not maintained; it is
  not silent; it never widens acceptance. The plan's Complexity Tracking records
  it as an accepted deviation rather than pretending it is not one.
- **The dialect is pinned to a version.** It was measured against Ollama 0.35.0.
  A later release may fix `pattern`, at which point this costs enforcement for
  nothing; an earlier one may have other gaps. `pnpm frames` is the re-measurement.
- **Silent failures in keywords nobody has bisected yet are still silent.** This
  fixes the one that was found.

## Verification

- `packages/core/test/schema-dialect.test.ts` — removal at every schema
  position; a property named `pattern` survives; `const`/`enum`/`default` data is
  untouched; the input is not mutated; identity when nothing is dropped; and the
  validator still refuses a control character after adaptation.
- `packages/core/test/frames.test.ts` — the request an Ollama client sends has no
  `pattern`; the one a relaxAI client sends does; `schema_adapted` is emitted for
  the first and not the second; a value violating the dropped keyword still ends
  the stream in `schema_violation`.
- `examples/next-app/e2e/dashboard.spec.ts` — the stand-in endpoint records
  whether the schema it received carried `pattern`, and the test holds the app to
  `false`.
- Live: `pnpm frames` against Ollama, results in the plan's Verification table.
