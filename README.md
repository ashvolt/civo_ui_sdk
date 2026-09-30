<div align="center">

# relaxAI Generative UI SDK

**Stream schema-validated, model-designed interfaces from [Civo relaxAI](https://www.civo.com/ai/relaxai) — safely, on the edge, without leaving UK jurisdiction.**

`@civo/relax-ui-core` · `@civo/relax-ui-react` · `@civo/relax-ui-next`

TypeScript · Zod 3 & 4 · Next.js App Router · zero runtime dependencies in core

</div>

---

## The problem this solves

relaxAI gives UK organisations frontier open-weight models inside UK legal
jurisdiction, behind an API that is **1:1 compatible with OpenAI's**. For a team
that wants *generative UI* — interfaces whose structure a model decides at request
time — that compatibility solves transport and nothing else.

What is left is the awkward part:

| Gap | Why it bites |
|---|---|
| **Capability ≠ parity** | `response_format: json_schema` is a *server* feature. Whether a given open-weight model honours it is not discoverable from the protocol, and the catalogue changes as models land. |
| **Streaming vs parsing** | A blank screen for four seconds reads as broken. But a half-written JSON document cannot be parsed, and waiting for the last token throws the requirement away. |
| **Untrusted structure** | Model output that becomes UI is attacker-influenced markup. No frontend reviewer approves rendering it as-is. |
| **Two sources of truth** | You have a Zod schema. You do not want a hand-maintained JSON Schema beside it, drifting. |
| **Response wrappers** | DeepSeek R1 emits `<think>`. GPT-OSS emits harmony channels. Llama adds fences and pleasantries. All break `JSON.parse`. |

Today every team solves these per-application, badly, by whoever gets the ticket.

## What this SDK does about it

```ts
// One declaration. It becomes the JSON Schema relaxAI is sent, the server-side
// validator, the TypeScript type, and the renderer's lookup table.
const registry = createUIRegistry({
  Stack:  { props: z.object({ heading: displayText(120).optional() }), children: "required" },
  Metric: { props: z.object({ label: displayText(60), value: displayText(24) }) },
  Source: { props: z.object({ label: displayText(80), href: urlString({ schemes: ["https:"] }) }) },
});
```

```ts
// app/api/ui/route.ts — the whole server side.
export const runtime = "edge";
export const POST = createGenerativeUIRoute({
  client: new RelaxClient(),
  model: "Llama-4-Maverick-17B-128E",
  schema: registry.structuredSchema("Dashboard"),
  inputSchema: z.object({ topic: z.string().min(3).max(300) }),
  toMessages: (input) => [{ role: "user", content: `Dashboard about: ${input.topic}` }],
});
```

```tsx
// app/page.tsx — the whole client side.
const { object, isStreaming, submit } = useGenerativeObject<{ root: UINode }>({ api: "/api/ui" });
<Dashboard node={object?.root} />
```

That is 27 lines across three files, and what you get is a layout the model chose,
streaming in, every node validated before it renders, with nothing outside your
vocabulary able to appear.

→ **[Quickstart](./specs/001-generative-ui-sdk/quickstart.md)** ·
**[Reference app](./examples/next-app)** · **[API reference](./docs/api-reference.md)**

---

## How it works

### Capability is negotiated, never assumed

Three ways to get schema-conformant JSON, tried strongest-first, downgrading when
the server says no — and **remembering**, so a wrong guess costs one request per
model per process rather than one per call.

| Tier | Mechanism | Guarantee |
|---|---|---|
| 1 | `response_format: json_schema` | Shape violations are *impossible* — invalid tokens are never sampled |
| 2 | Forced tool call | Clean JSON, no prose; what most of the catalogue actually uses |
| 3 | Schema in the prompt | Works on any chat model; the floor, so a wrong table never fails |

The strategy used and any downgrades come back in `metadata`. Silent degradation
is a debugging tax we refuse to levy.

→ [ADR-0002](./docs/adr/0002-capability-negotiated-structuring-ladder.md) ·
[ladder diagram](./docs/diagrams/03-structuring-ladder.md)

### Partial JSON, parsed properly

The model has written `{"title":"Quarterly rev`. You want "Quarterly rev" on
screen now.

| Buffer | Yields | Why |
|---|---|---|
| `{"title":"Quarterly rev` | `{"title":"Quarterly rev"}` | Progressive prose is the point of streaming |
| `{"a":1,"ti` | `{"a":1}` | A half-named key would lie about the object's shape |
| `{"ok":tru` | `{}` | Incomplete literal rewinds |
| `{"s":"a\` | `{"s":"a"}` | Dangling escape trimmed, or the repair itself breaks |

Tested against **every prefix** of a realistic document, because these are the
cases no human thinks to type.

→ [scanner state machine](./docs/diagrams/07-partial-json-state.md)

### Validation that understands "not finished yet"

Mid-stream the object is *supposed* to be incomplete. Rather than derive a
deep-partial schema — removed in Zod 4, and fragile in 3 — the SDK runs your real
schema and classifies what it complains about:

- **pending** — missing key, short string, half-spelled enum → tolerated while the
  stream is open;
- **fatal** — wrong type, unknown key → the stream stops *now*.

So a `score: "nine"` detected on token 4 does not cost the remaining 2,000 tokens.
It also happens to work identically on Zod 3 and Zod 4.

→ [ADR-0005](./docs/adr/0005-streaming-partial-validation.md)

### Model output is untrusted input

Generative UI moves the XSS surface from *what the developer wrote* to *what the
model was persuaded to write*. The mitigation is a closed vocabulary, not a
sanitiser:

- the legal `type` set is **closed at schema-construction time** — an unregistered
  component has no branch in the union, so a document naming it fails validation;
- props are validated per component, and objects are `.strict()`, so a smuggled
  `onClick` is a failure rather than a silent drop;
- `urlString()` rejects `javascript:` at **validation** time, before a frame is
  sent — `z.string().url()` would accept it;
- there is **no `dangerouslySetInnerHTML` anywhere in the SDK**, and CI greps for
  it;
- documents are size- and depth-bounded, checked iteratively — a recursive check
  overflows the stack while measuring, i.e. the guard fails before it fires.

Every one of those has a test asserting the *refusal*.

→ [Security model](./docs/security-model.md) ·
[trust boundaries](./docs/diagrams/06-trust-boundaries.md)

### Sovereignty is not a setting

relaxAI's reason to exist is jurisdictional. An SDK that quietly accepts any
`baseURL` or ships a telemetry beacon hands that back without the buyer noticing.

- the endpoint host is allowlisted, checked in the **constructor**, so a
  misconfigured `RELAX_BASE_URL` fails the deploy rather than exfiltrating prompts;
- plaintext HTTP is refused (loopback needs an explicit opt-in that cannot widen
  to a remote host);
- **zero runtime dependencies in core** — the whole egress path is auditable in an
  afternoon;
- there is no analytics endpoint, no version check, no error reporter. Observability
  is in-process counters you export yourself.

→ [ADR-0003](./docs/adr/0003-no-openai-sdk-dependency.md)

---

## Packages

| Package | Responsibility | Runtime deps |
|---|---|---|
| [`@civo/relax-ui-core`](./packages/core) | Transport, negotiation, strategies, streaming parse + validate, guards, wire protocol | none (Zod is a peer) |
| [`@civo/relax-ui-react`](./packages/react) | Streaming object hook, allowlist-only renderer | core, React |
| [`@civo/relax-ui-next`](./packages/next) | App Router handler factories | core |

Core runs unchanged on **Node ≥ 20, Vercel Edge, Cloudflare Workers, Bun and
Deno**: `fetch` is the only platform API it requires, and it imports nothing from
`node:`.

---

## How this repository is built

Developed with [GitHub Spec Kit](https://github.com/github/spec-kit):
**constitution → specify → clarify → plan → tasks → implement**. The artefacts are
the review surface — code review of a 4,000-line SDK cannot recover the intent a
spec would have stated in a page.

| Artefact | What it holds |
|---|---|
| [Constitution](./.specify/memory/constitution.md) | Seven principles, gated twice per feature |
| [Specification](./specs/001-generative-ui-sdk/spec.md) | Scenarios, 26 functional + 8 non-functional requirements, clarifications |
| [Research](./specs/001-generative-ui-sdk/research.md) | Nine investigations, with what was **rejected** and why |
| [Plan](./specs/001-generative-ui-sdk/plan.md) | Constitution checks, design decisions, known limitations |
| [Data model](./specs/001-generative-ui-sdk/data-model.md) | Nine entities with their invariants |
| [Contracts](./specs/001-generative-ui-sdk/contracts/) | Wire protocol, upstream assumptions, public API |
| [Tasks](./specs/001-generative-ui-sdk/tasks.md) | 60 dependency-ordered tasks (57 complete, 3 outstanding), tests before implementation |

### Design documentation

| Document | For |
|---|---|
| [HLD](./docs/hld.md) | Context, containers, lifecycle, quality attributes, risks |
| [LLD](./docs/lld.md) | Module internals, algorithms, complexity, the cases that motivated them |
| [Security model](./docs/security-model.md) | Assets, adversaries, controls — and what is *not* defended |
| [ADRs](./docs/adr/) | Six load-bearing decisions, each with its rejected alternatives |
| [Diagrams](./docs/diagrams/) | Eight Mermaid diagrams, all render-verified |
| [API reference](./docs/api-reference.md) | Every export, with examples |
| [Troubleshooting](./docs/troubleshooting.md) | Symptoms first |

---

## Development

```bash
pnpm install
pnpm verify      # typecheck + 128 tests + build

cd examples/next-app && pnpm dev
```

The test suite runs entirely against injected `fetch`, `sleep`, `random` and `now`,
so it exercises real code paths — the actual client, the actual retry loop — with
no network and no wall-clock waiting. There are no module mocks.

| Suite | Tests | Emphasis |
|---|---|---|
| Partial JSON | 21 | Rewind rules, escapes, **every prefix** of a realistic document |
| JSON Patch | 12 | Round-trip, array ordering, structural sharing |
| JSON Schema | 14 | Constraints, unions, `$defs` recursion, deliberate throws |
| Guards | 19 | Every refusal path |
| UI contract | 15 | Unknown components, bad props, `javascript:`, a 200k-deep tree |
| Orchestration | 17 | Each tier, downgrade + persistence, repair, full ladder walk |
| React | 20 | Renderer refusals, escaping, keying; stream decoding |
| Next route | 10 | Input rejection, smuggled model/system, status mapping |

---

## Status and honest caveats

Feature-complete and tested, **not yet published**. Two things a reviewer should
know:

1. **The capability priors are not verified against the live API.** This was built
   in an environment whose egress policy blocks `relax.ai`, so the per-model table
   is assembled from Civo's published documentation and each entry carries a `note`
   saying so. The architecture is designed to absorb a wrong prior — one wasted
   request per model per process, never a failure, because the floor strategy needs
   no server feature at all — but
   [T-056](./specs/001-generative-ui-sdk/tasks.md#outstanding) exists to replace
   priors with measurements, and it should land before a 1.0.
2. **Other known limitations** — the Zod → JSON Schema subset, positional array
   diffing, no built-in rate limiting — are listed in
   [plan.md](./specs/001-generative-ui-sdk/plan.md#known-limitations) rather than
   left to be discovered.

---

## Licence

Apache-2.0.

Not an official Civo project. Built as a proof-of-work prototype against relaxAI's
public API surface.
