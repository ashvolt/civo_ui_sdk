# Phase 0 — Research

**Feature**: 002-provider-agnostic-inference
**Date**: 2026-10-05

Unlike feature 001's research, most of this was *measured*: a local Ollama was
available, so each question about its behaviour was put to it directly rather
than read from documentation. The measurements are what changed the design.

**Test bench**: Ollama 0.35.0 on Windows 11, CPU inference, models `qwen2.5:3b`,
`qwen2.5:7b`, `qwen2.5:14b`, `llama3.2:1b`, `llama3.2:3b`, `qwen3:4b`. Requests
to the OpenAI-compatible route, `http://127.0.0.1:11434/v1`.

---

## R1. Where is the SDK actually coupled to relaxAI?

**Question**: what would have to change for the engine to run against another
endpoint?

**Findings**: less than the names suggest. A survey of `packages/core/src`:

| Coupling | Where | Kind |
|---|---|---|
| Default base URL, default allowlist | `relax-client.ts`, `sovereignty.ts` | configuration |
| API key is mandatory | `relax-client.ts` constructor | policy |
| `client: RelaxClient` in option types | `generate.ts`, `next/route.ts` | nominal type |
| One process-wide capability registry | `registry.ts` | shared state |
| Capability keyed by model name only | `registry.ts` | data model |
| "relaxAI returned…" in error text | `relax-client.ts`, `strategy/index.ts` | wording |

Nothing in the ladder, the partial parser, the validator, the patch transport or
the wire protocol knows which endpoint it is talking to. The reference app had
already proved the point by pointing `RelaxClient` at Ollama with a placeholder
key (`apiKey: "ollama-local"`) and a hand-built policy — which works, and is
exactly the kind of workaround that shows a missing abstraction.

**Decision**: introduce the abstraction the workaround was standing in for.
An `InferenceClient` interface for the engine to depend on, and a
`ProviderProfile` that carries what was scattered: base URL, egress policy, key
requirement, sovereignty, capability refinements.

**Rejected**: *renaming `RelaxClient` to something neutral.* Breaks every
feature-001 application for no behavioural gain. `RelaxClient` stays, as the
relaxAI-flavoured subclass.

---

## R2. Does Ollama honour `response_format: json_schema`?

**Question**: the shipped prior says no local Qwen/Llama build does constrained
decoding, so the ladder starts at `tool_call`. Is that right?

**Measured**: no — it is a property of the *server*. Ollama applies a grammar
derived from the schema regardless of the model.

```
POST /v1/chat/completions   model=qwen2.5:3b   response_format=json_schema(Metric)
→ 200, content streamed token by token: `{` `"` `label` `":` ` "` `2` `0` …
```

That is `qwen2.5:3b` with a flat three-field schema. The stronger evidence came
later: with R3's fix in place, all five chat models on the bench completed the
full recursive `Dashboard` schema through this tier (plan.md, Verification).

**Decision**: capability must be refinable per provider (FR-109). The Ollama
profile declares `jsonSchema: true` for chat models; the model-name table keeps
its own conservative prior for everyone else.

**Consequence**: the capability registry can no longer be one process-wide
object. `qwen2.5:7b` behind Ollama and `qwen2.5:7b` behind a vLLM gateway are
different facts (FR-110).

---

## R3. Does Ollama honour it for the *real* schema?

**Question**: R2 used a three-field schema. The reference app's `Dashboard` is
recursive (`$defs` + `$ref`), a seven-way `anyOf`, with `pattern`, `default`,
`maxLength` and `description` throughout.

**Measured**: the request is accepted with a 200 and the schema is **not
enforced**. The model returned props the schema forbids (`unit`, `color`,
`title` on a `Metric`) and trailing prose after the document.

No error, no warning, nothing in `server.log`. Bisecting by removing one keyword
family at a time — `qwen2.5:3b`, same prompt, one run per variant:

| Variant | Enforced? | Evidence |
|---|---|---|
| A — full schema | **no** | `Metric.props.unit` emitted |
| B — without `$schema` | **no** | `Metric.props.unit` emitted |
| C — without `pattern` | yes | only declared props, enum values legal |
| D — without `$schema`, `pattern` | yes | complete, valid document |
| E — D without `default`, `description` | yes | complete, valid document |

`pattern` is the keyword. Recursion, `anyOf`, `const`, `default` and `maxLength`
are all handled.

One run per variant is suggestive, not proof, so the conclusion was then tested
through the whole pipeline — forced onto the constrained tier, repair disabled,
three seeds per cell:

| Model | Schema sent | Completed | How the others ended |
|---|---|---|---|
| qwen2.5:3b | without `pattern` | 3 / 3 | — |
| qwen2.5:3b | as authored | 0 / 3 | never finished inside a 500-token budget |
| llama3.2:3b | without `pattern` | 3 / 3 | — |
| llama3.2:3b | as authored | 0 / 3 | `schema_violation`: unknown keys, wrong types |

Twelve generations, and the keyword decides every one of them.

**Why this matters more than it looks**: this is the worst failure shape an
endpoint can have. A 400 would have been caught by `isCapabilityRejection` and
the ladder would have walked down. A 200 that ignores the schema reaches the
fail-fast validator as a wrong-shaped document, and the generation dies with
`schema_violation` on a tier the endpoint *could* have served correctly.

**Decision**: a provider declares a **schema dialect** — the keywords its
constrained decoder cannot honour — and the SDK derives the *wire schema* by
omitting them (FR-111). The application's schema stays the validator (FR-112),
so a string that violates the dropped `pattern` is still refused; it is just
refused by us rather than prevented by the server.

**Rejected**:

- *Drop `pattern` for everyone.* Throws away real enforcement on servers that
  implement it, to accommodate one that does not.
- *Detect the silent failure and downgrade.* Possible only after the damage: the
  bad tokens are already generated and, mid-stream, already partly painted.
  Avoiding the failure costs nothing; recovering from it costs a generation.
- *Ask applications not to use `pattern`.* `displayText()` — the SDK's own
  helper — emits one. The control-character guard it expresses is a Principle IV
  control and is not negotiable.

**Tension with Principle II, recorded honestly**: Principle II says the SDK
"MUST fail loudly … rather than emit an approximation that silently
mis-describes the shape to the model". The wire schema is a *looser* description
than the real one. It is not silent (a `schema_adapted` trace event names the
dropped keywords), it is derived, not maintained, and it never widens what is
accepted. See the plan's Complexity Tracking.

---

## R4. How do tool calls stream on Ollama?

**Question**: the tool tier is the one feature 001 expected local models to use.
What do its frames look like?

**Measured**, three models, forced and `required` tool choice:

| Model | Choice | Chunks | Chunks carrying arguments | Result |
|---|---|---|---|---|
| qwen2.5:3b | forced | 2 | 1 | whole document in one chunk |
| qwen2.5:3b | required | 2 | **0** | **nothing**; `finish_reason: stop` |
| llama3.2:3b | forced | 2 | 1 | whole document in one chunk |
| llama3.2:3b | required | 2 | 1 | `trend: "unknown"` — not in the enum |
| qwen2.5:7b | forced | 2 | 1 | whole document in one chunk |
| qwen2.5:7b | required | 2 | 1 | whole document in one chunk |

Three separate findings:

1. **Tool-call arguments are never streamed incrementally.** Ollama buffers the
   call and emits it whole. Through the tool tier the browser receives `meta`,
   one `snapshot`, `complete`. Correct, and not streaming: the user stares at an
   empty page for the whole generation.
2. **A tool call sometimes returns nothing at all.** Observed twice in three
   requests to `qwen2.5:3b`: once with the tool forced by name (an earlier run
   than the one tabulated), once with `required`. Feature 001 handled this by
   re-asking through the *same* tier, off-stream — the tier that just failed.
3. **Tool arguments are not schema-constrained.** `trend: "unknown"`.

**Decisions**:

- With R2, the Ollama profile's ladder is `native_json_schema → tool_call →
  prompted_json`, so the incremental mechanism is tried first (FR-113). No new
  ladder logic is needed: it falls out of the capability refinement.
- A tier that ends empty-handed before any document frame downgrades (FR-114).
  It is safe exactly because nothing has been painted.
- That requires the opening `meta` frame to be written when the first document
  frame is ready rather than on the first upstream chunk — otherwise `meta`
  would name a mechanism that then produced nothing (FR-115). `meta` is still
  first; it is simply no longer early.

**Rejected**: *a `toolCallStreaming` capability flag with its own ladder
ordering rule.* More machinery than the problem needs; on every endpoint
measured so far, "prefer constrained decoding where it exists" gives the same
answer.

---

## R5. Reasoning models on the local route

**Measured**: `qwen3:4b` with `reasoning_effort: "none"` on the OpenAI route
still reasons, and emits the reasoning as plain `content` with **no `<think>`
tags** — so it cannot be stripped. Feature 001 had already found `think: false`
is ignored on this route.

Under constrained decoding the grammar forces `{` as the first token, which
suppresses the preamble. So R2's decision also fixes this — for the constrained
tier only. Confirmed afterwards: `qwen3:4b` completed the full `Dashboard` in
136 s through that tier, 220 frames, where feature 001's notes record the same
model running for nine minutes on the tool tier and then failing.

**Decision**: no new mechanism. Model auto-selection continues to rank
reasoning families behind straight-answering ones; the troubleshooting guide
says why.

---

## R6. One interface or one base class?

**Question**: what should `generateObject` depend on?

**Decision**: a structural **interface** (`InferenceClient`), with one
implementation shipped (`OpenAICompatibleClient`). The engine calls four
methods and reads two properties; anything that provides them works — a client
for a non-OpenAI protocol, an in-process model, a recording/replay harness.

**Rejected**: *an abstract base class.* Forces `extends`, which drags the
transport, retry policy and key handling into implementations that want none of
them, and makes "is it an inference client" a prototype-chain question across
duplicated package copies.

---

## R7. Which local runtimes get a built-in profile?

| Runtime | Default base URL | Constrained decoding | Notes |
|---|---|---|---|
| Ollama | `http://127.0.0.1:11434/v1` | yes, minus `pattern` (measured, R3) | tool calls unstreamed (R4) |
| LM Studio | `http://127.0.0.1:1234/v1` | documented; **unmeasured here** | prior only |
| llama.cpp `server` | `http://127.0.0.1:8080/v1` | documented; **unmeasured here** | prior only |

**Decision**: ship all three, mark the unmeasured ones as priors in their
`note`, and keep them conservative: no capability refinement is claimed for a
runtime that was not on the bench. A wrong prior costs one wasted request per
model per process (feature 001, ADR-0002), so shipping an honest prior is
cheaper than shipping nothing.

**Rejected**: *a profile per hosted vendor.* Each one is an endorsement that a
non-sovereign endpoint is a supported destination for prompts. `defineProvider`
exists; the application that wants one writes four lines and owns the decision.

---

## R8. How is the video made?

**Constraints**: no `ffmpeg` on the machine; must be reproducible (FR-119);
must show a real generation, not a mock-up.

**Decision**: Playwright's built-in recorder (WebM/VP8, bundled encoder), driving
the reference app in Chromium against the local model, with on-page captions
injected by the script. The app's frame inspector (FR-121) is opened so the
frames are visible beside the document they build.

**Rejected**:

- *Screen-recording by hand.* Not reproducible.
- *Rendering frames to PNG and assembling with ffmpeg.* Adds a system
  dependency for a worse result than recording the real page.
- *Recording against the stub endpoint.* Deterministic, and no longer a
  demonstration of an open-weight model. Kept as an option (`DEMO_ENDPOINT=stub`)
  for machines with no model, and labelled as such on screen.

---

## R9. Should a constrained tier also show the model its schema?

**Question**: grammar-constrained decoding forces the *shape*, but Ollama does
not put the schema in the prompt, so the model never reads the `description` on
a prop. One recorded generation put a sentence in `Metric.value` and the figure
in `caption` — schema-valid, and wrong. Is that systematic, and would injecting
the schema into the system prompt fix it?

**Measured**, `llama3.2:3b`, same prompt, two seeds per variant:

| Variant | Metric values | First paint | Total |
|---|---|---|---|
| schema hidden (as shipped) | `£10.2bn`, `£11.5bn`, `12%` | 1 s | 34 s |
| schema hidden | `£10B`, `£12B`, `20%` | <1 s | 33 s |
| schema shown | `£1.2m`, `£1.8m`, `£0.6m` | 24 s | 73 s |
| schema shown | `£1.2m`, `£1.8m`, `52%` | <1 s | 51 s |

**Findings**: the hypothesis does not hold. With the schema hidden the model
filled `value` correctly in both runs; the bad generation was one sample, not a
pattern. With the schema shown, the model **copied the example out of the
description** (`"e.g. '£1.2m'"`) into every metric, and the generation took
1.5–2× as long because ~1,500 extra prompt tokens have to be evaluated on CPU.

**Decision**: do nothing. No `schemaInPrompt` flag on the profile.

**Rejected**: *showing the schema on constrained tiers.* It trades an occasional
misplaced value for a systematic anchoring on example text and a doubled
latency. Recorded because it is the obvious next idea, and the measurement says
it is the wrong one.

**What it does say**: on a small model, a `description` that contains a literal
example is a prompt-injection risk of the mundane kind — the example becomes the
answer wherever the model can read it. That is advice for registry authors, and
it is in the troubleshooting guide.

---

## Sources

All measurements above were taken on 2026-10-05 against the bench described at
the top, with the commands preserved in `scripts/inspect-frames.ts` (`pnpm
frames`) for anyone who wants to repeat them against a different build.
