# ADR-0007 — The endpoint is a provider profile behind an inference interface

**Status**: Accepted · **Date**: 2026-10-05 · **Principle**: I, III, V
**Feature**: [002-provider-agnostic-inference](../../specs/002-provider-agnostic-inference/spec.md)

## Context

Feature 001 built an engine that never mentions relaxAI — the ladder, the partial
parser, the validator, the patch transport and the wire protocol are all
endpoint-agnostic — and then typed its entry points as `client: RelaxClient`,
gave that client a mandatory API key, and kept one capability table for the
whole process keyed by model name.

The reference app showed what that cost. To run against a local model it
constructed a `RelaxClient` with `apiKey: "ollama-local"`, a hand-written
loopback policy, and its own provider switch that fell back to relaxAI on a
typo. It worked. It was also three workarounds for one missing abstraction, and
two of them were in tension with Principle I: a placeholder credential on the
wire, and a misconfiguration that silently selected the hosted endpoint.

Measurement then made the capability table's shape untenable. `qwen2.5:3b`
behind Ollama 0.35 honours constrained decoding, because Ollama compiles the
schema to a grammar server-side; the name-based prior says it does not. The
same weights behind a different server would behave differently again.
Capability was never a property of a model name.

## Decision

Two things, deliberately separate.

**An interface the engine depends on.** `InferenceClient` — `provider`,
`capabilities`, `schemaDialect?`, `listModels`, `chatCompletion`,
`streamChatCompletion`. `generateObject`, `streamObject` and the route adapter
take any object that satisfies it.

**A profile that describes an endpoint.** `ProviderProfile` is frozen data: id,
base URL, egress policy, key requirement, `sovereign`, `local`, capability
refinements, schema dialect. `OpenAICompatibleClient` takes one; `RelaxClient` is
that class with the profile fixed. Built-ins: `relaxai`, `ollama`, `lmstudio`,
`llamacpp`. `defineProvider` for anything else.

With three rules that are the actual decision:

1. **The guard runs for every provider.** A local profile is not exempt; it
   carries `LOOPBACK_ONLY_POLICY`. The environment may move a provider's base
   URL but only code (`options.sovereignty`) may change who can be dialled.
2. **No fallback, ever.** An unknown provider name is `config_invalid`. There is
   no fail-over between providers at request time either.
3. **Capability is scoped to the endpoint.** One `CapabilityRegistry` per
   `(provider id, origin)`. A profile may add `endpointDefaults` to every chat
   model it serves; observations stay in the registry they were made in.

## Alternatives considered

**Rename `RelaxClient` to a neutral name and add a `baseURL` preset list.**
The smallest change. Rejected: it breaks every feature-001 application for no
behavioural gain, and it leaves capability keyed by model name, which is the
part that is actually wrong.

**An abstract base class instead of an interface.** Rejected: `extends` drags
the HTTP stack, retry policy and key handling into implementations that want
none of them (an in-process model, a replay harness), and makes "is this an
inference client" a prototype-chain question that fails across duplicated
copies of the package.

**Adopt an existing multi-provider abstraction.** Rejected on the same grounds
as ADR-0003: a second HTTP stack and somebody else's capability assumptions,
inside a library whose pitch is a controlled egress path. Also a runtime
dependency, which Principle V forbids in core.

**A profile for every hosted vendor.** Rejected: each built-in is an
endorsement that a non-sovereign endpoint is a supported destination for
prompts. Local runtimes are built in because they are the *development* story
for the sovereign endpoint. A third-party hosted API is the application's
decision, and `defineProvider` makes it four lines the application owns.

**Automatic fail-over to a second provider when the first is down.** Rejected
outright. Sending a prompt to an endpoint the request did not name, because the
named one was unavailable, is precisely the surprise Principle I exists to rule
out. Availability is the application's problem to solve explicitly.

**Let profiles carry hooks (request transformers, response parsers).** Rejected:
a profile that runs code is no longer auditable as data, and an endpoint that
needs its request rewritten is speaking a different protocol — which is what
`InferenceClient` is for.

## Consequences

**Good**

- Every code path runs against an open-weight model on a developer's machine,
  with no account and no placeholder key. Verified against five local models.
- The sovereignty claim got *stronger*: provider identity now travels on the
  wire (`meta.provider`) and in metadata, a local endpoint cannot be labelled
  sovereign, and a typo cannot select the hosted endpoint.
- A latent bug is gone: one endpoint's learned rejections no longer apply to a
  different endpoint that happens to serve a model of the same name.
- Feature 001's 156 tests passed, untouched, against the refactored client
  before any behaviour was changed. Three assertions were then changed on
  purpose, each with its reason beside it: a half-written number is now held
  rather than dropped; the example's provider switch throws rather than falling
  back; and the browser test expects the constrained tier on a runtime that
  honours it.

**Bad**

- **`sovereign` is asserted, not verified.** The SDK cannot check a jurisdictional
  claim. A `defineProvider({ sovereign: true })` for an endpoint that is no such
  thing will be believed. Mitigated only by the fact that it has to be written
  down, in code, where a reviewer can see it.
- **Two more built-ins are priors.** `lmstudio` and `llamacpp` were not on the
  bench. They claim nothing beyond an address and a loopback policy, so the cost
  of being wrong is the ordinary one — a wasted request per model per process —
  but they are unmeasured and their `note` says so.
- **A wider public surface.** Seventeen new value exports from core. Each is something
  a future change has to keep working.
- **`createClient()` reads the environment.** It is the one place the SDK lets
  the deployment choose an endpoint. Applications that want that choice in code
  have `RelaxClient` and `provider:`, but the convenient function is the one
  with the indirection.
- **Registries are never evicted.** One per `(provider, origin)`, for the life of
  the process. Unbounded only if an application constructs clients for unbounded
  distinct origins, which the allowlist makes hard to do by accident.

## Verification

- `packages/core/test/provider.test.ts` — 36 tests, most asserting a refusal:
  unknown name, remote host on a local profile (both `https` and plaintext), an
  environment variable trying to widen the allowlist, a sovereign profile that
  permits plaintext, a keyless provider sending no `Authorization` header.
- `packages/core/test/frames.test.ts` — an `InferenceClient` written as a plain
  object drives both `streamObject` and `generateObject`.
- `examples/next-app/e2e/` — the banner states the endpoint and that it is not
  sovereign; `meta` names `ollama`.
- CI's Principle I grep is unchanged and still passes: the only absolute URLs in
  core are `api.relax.ai` and loopback addresses.
