# ADR-0002 — Negotiate a three-tier structuring ladder per model

**Status**: Accepted · **Date**: 2026-09-29 · **Principle**: III

## Context

relaxAI is 1:1 OpenAI-compatible at the protocol level. It is not OpenAI at the
capability level: the catalogue is open-weight models — Llama 4, DeepSeek R1 and
V3/V4, GPT-OSS, GLM 4.6, Kimi — and `response_format: {type: "json_schema"}` is a
*server* feature (guided decoding), not a protocol feature. Whether any given
model honours it is not discoverable from the protocol, and the catalogue changes
as new models land.

An SDK that assumes constrained decoding fails on most of the catalogue. One that
assumes nothing throws away a real guarantee on the models that have it, and
burns tokens restating a schema the server could have enforced for free.

## Decision

Three strategies, ordered by strength of guarantee, selected from overridable
per-model capability data, with automatic downgrade on rejection:

1. `native_json_schema` — server constrains decoding. Shape violations are
   *impossible*, not merely unlikely.
2. `tool_call` — schema as a forced function signature. Widely implemented,
   heavily post-trained; arguments arrive clean.
3. `prompted_json` — schema in the prompt. Works on any chat model.

A rejection is written back to the capability registry, so the cost of a wrong
prior is one wasted request per model per process. The strategy used and any
downgrades appear in `metadata`.

## Alternatives considered

**Pick one mechanism.** Tool calling alone would work on most of the catalogue —
but not DeepSeek R1, and it forgoes the hard guarantee on GLM and DeepSeek V4.
Prompting alone works everywhere and is the weakest and most expensive.

**Require the caller to declare the mechanism.** Rejected: it pushes a research
task onto every application, and the answer changes when Civo adds a model.

**Probe capabilities at startup.** Rejected: a cold-start round-trip per model to
learn what the first real request discovers for free.

**Grammar/EBNF constrained decoding.** Rejected: not part of the
OpenAI-compatible surface, so not portable across the catalogue.

## Consequences

**Good**
- Correct on every model, optimal on the good ones.
- A new relaxAI model works immediately at the floor, and can be promoted by a
  one-line table entry.
- Degradation is visible, so a team can see it is paying prompt tokens for
  something a newer model would enforce.

**Bad**
- One wasted request when a prior over-claims.
- `isCapabilityRejection` matches on error **message text**, because
  OpenAI-compatible servers are inconsistent about signalling an unsupported
  feature. Recorded as a judgement call in `plan.md`: its worst case is a missed
  downgrade surfacing as a normal error, so it fails safe.
- Three request builders and three response readers to maintain.

## Verification

`generate.test.ts` walks the full ladder (`json_schema` 400 → `tools` 400 →
prompted success), asserts the downgrade is persisted in the registry, asserts
`metadata.downgradedFrom`, and asserts that a 401 does **not** downgrade.
