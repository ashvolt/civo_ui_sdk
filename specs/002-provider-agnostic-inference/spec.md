# Feature Specification: Provider-Agnostic Inference

**Feature Branch**: `002-provider-agnostic-inference`
**Created**: 2026-10-05
**Status**: Implemented
**Input**: "Check the frame creation and produce a demo video. Use an open-source
model to create the frames instead of relying on relaxAI, so the SDK is loosely
coupled. It must run on my own machine against Ollama models."

---

## Clarifications

### Session 2026-10-05

- Q: Does "loosely coupled" mean relaxAI stops being the default?
  → **A: No.** relaxAI remains the endpoint an application gets when it names no
  other. What changes is that the engine no longer *requires* it: the endpoint
  becomes a selectable provider, and every code path can be exercised against a
  model running on the developer's machine. (Drives FR-101, FR-102.)

- Q: Does selecting a local provider switch the sovereignty guard off?
  → **A: No.** The guard runs for every provider. A local provider carries a
  loopback-only allowlist, so it cannot be repurposed to reach a remote host in
  the clear. (Drives FR-105..107. Constitution v1.1.0, Principle I.)

- Q: Is a local model a "sovereign" endpoint?
  → **A: It makes no jurisdictional claim, so it is not labelled as one.** Prompts
  do not leave the machine, which is a stronger *locality* property, but
  "sovereign" in this SDK means a provider's stated legal guarantee. The two are
  reported separately and neither is inferred from the other. (Drives FR-108.)

- Q: What should happen when the provider name in the environment is misspelt?
  → **A: A configuration error.** Feature 001's example fell back to relaxAI with
  a warning; that is a misconfiguration that looks like it worked. (Drives
  FR-103.)

- Q: The same model name can sit behind two servers. Whose capabilities win?
  → **A: The endpoint's.** Capability is recorded per (endpoint, model). Measured
  on 2026-10-05: `qwen2.5:3b` behind Ollama 0.35 honours constrained decoding,
  which the model-name prior alone says it does not. (Drives FR-109, FR-110.)

- Q: An endpoint accepts `response_format: json_schema`, returns 200, and then
  ignores the schema. Is that a capability rejection?
  → **A: It is a capability failure the server did not report**, and it has to be
  handled without trusting the status code. Measured: Ollama 0.35 silently drops
  enforcement when the schema carries a `pattern` keyword. The SDK sends such an
  endpoint a schema it can enforce and validates the result against the full
  one. (Drives FR-111, FR-112.)

- Q: Is one frame containing the whole document an acceptable stream?
  → **A: It is correct, and it is not streaming.** Measured: Ollama delivers a
  tool call's arguments in a single chunk, so the tool-calling mechanism paints
  the document all at once. Where an endpoint has a mechanism that streams
  incrementally, that one is preferred. (Drives FR-113.)

- Q: Must the demo video be reproducible, or is a one-off recording enough?
  → **A: Reproducible.** A recording nobody can regenerate goes stale the first
  time the UI changes. It is produced by a committed script from the real
  application. (Drives FR-119.)

*No `[NEEDS CLARIFICATION]` markers remain.*

---

## User Scenarios & Testing

### Primary User Story

Dev is evaluating the SDK on a laptop. They have no relaxAI account yet, and the
security review that would let them send anything to a hosted API has not
happened. They do have Ollama, with a few small open-weight models pulled.

They want to see the thing work: a prompt goes in, a layout streams onto the
page piece by piece, and it is the same engine, the same validation and the same
wire protocol they would ship. They do not want a mock. They want to set one
environment variable, run the reference app, and watch frames arrive.

Later the same code is deployed against relaxAI. Nothing in the application
changes except the provider it names.

Priya, from feature 001, is the second reader. Her concern is the opposite one:
that making the endpoint selectable has quietly made the compliance boundary
optional. For her the feature is only acceptable if a local or third-party
endpoint can never be reached by accident, and can never be mistaken for the
sovereign one once it is in use.

### Acceptance Scenarios

1. **Given** an application that names no provider,
   **When** it constructs a client,
   **Then** it is talking to relaxAI under the default allowlist, exactly as in
   feature 001.

2. **Given** a developer with Ollama running and no relaxAI account,
   **When** they select the `ollama` provider,
   **Then** a client is constructed with no API key, and a generation streams a
   validated document from a model on their machine.

3. **Given** the `ollama` provider configured with a base URL on a remote host,
   **When** the client is constructed,
   **Then** construction is refused before any prompt is sent.

4. **Given** a provider name that is not registered,
   **When** a client is requested for it,
   **Then** a configuration error names the provider and lists the ones that
   exist. No client is returned.

5. **Given** a generation served by a non-sovereign provider,
   **When** the stream opens,
   **Then** the opening frame and the completion metadata both name the
   provider, and the client object reports that it is not sovereign.

6. **Given** an endpoint whose constrained decoder cannot handle a schema
   keyword,
   **When** a document is generated through that endpoint's constrained tier,
   **Then** the schema sent omits that keyword, the result is still validated
   against the application's full schema, and the adaptation is reported.

7. **Given** an endpoint that delivers a tool call as one chunk but streams
   constrained JSON incrementally,
   **When** a document is generated,
   **Then** the constrained tier is attempted first and the browser receives
   more than one document frame.

8. **Given** a model that answers a forced tool call with nothing at all,
   **When** no frame has yet been sent,
   **Then** the SDK moves to the next mechanism, records the downgrade, and the
   opening frame names the mechanism that actually produced the document.

9. **Given** a model that answers a forced tool call with the document as plain
   message text,
   **When** the stream ends,
   **Then** that text is parsed and validated, without a second generation.

10. **Given** a generation that cannot start (an embeddings model was selected,
    or no prompt was supplied),
    **When** the stream is consumed,
    **Then** it ends with one `error` frame carrying the real error code — not a
    generic transport failure.

11. **Given** something learned about a model on one endpoint,
    **When** the same model name is used on a different endpoint,
    **Then** the second endpoint starts from its own prior.

12. **Given** an application that implements the inference interface itself,
    **When** it passes that object to the generation functions,
    **Then** generation works without any SDK-provided client class.

13. **Given** a developer running the frame inspector against a local model,
    **When** the generation finishes,
    **Then** every frame is listed and the stream's sequencing and replay
    invariants are asserted, with a non-zero exit if any is broken.

14. **Given** the reference application,
    **When** a generation is running,
    **Then** the page can show each frame as it arrives — its kind, sequence
    number and size — beside the document it is building.

15. **Given** the recording script and a running local model,
    **When** it is executed,
    **Then** it produces a video of a real generation in the reference
    application, with no manual steps.

### Edge Cases

- **Local runtime not running**: the application still starts; the first request
  fails with a typed, retryable error that says what was unreachable.
- **Local runtime has no chat model installed**: a typed error that says so,
  rather than selecting an embeddings model.
- **Provider needs no key, and one is set anyway**: it is sent. A local gateway
  may sit behind an authenticating proxy.
- **Provider needs a key and none is set**: a configuration error naming the
  environment variable, as in feature 001.
- **A property in the application's schema is itself called `pattern`**: schema
  adaptation removes the keyword and leaves the property alone.
- **A reasoning model spends its whole budget thinking**: reported as
  `truncated`, as in feature 001; no partial document is presented as complete.
- **Two clients for the same provider in one process**: they share what has been
  learned about that endpoint's models.

---

## Requirements

Numbered from 101 so they cannot be confused with feature 001's.

### Functional

**Provider selection**

- **FR-101**: The endpoint a client talks to MUST be described by a provider:
  an identifier, a default base URL, an egress policy, whether a key is
  required, whether it is sovereign, and capability and schema refinements.
- **FR-102**: relaxAI MUST be the provider used when none is named.
- **FR-103**: An unregistered provider name MUST raise a configuration error
  that lists the registered ones. It MUST NOT fall back.
- **FR-104**: Providers for relaxAI, Ollama, LM Studio and llama.cpp MUST be
  built in, and an application MUST be able to define its own.

**Sovereignty**

- **FR-105**: The egress guard MUST run for every provider, at construction.
- **FR-106**: A built-in local provider MUST allowlist loopback hosts only.
- **FR-107**: Widening a provider's allowlist MUST be an explicit option on the
  client, never an environment variable alone.
- **FR-108**: A provider's sovereignty and locality MUST be readable from the
  client, and the provider's identifier MUST appear in the stream's opening
  frame and in completion metadata.

**Capability**

- **FR-109**: A provider MUST be able to refine a model's capability prior.
- **FR-110**: Runtime observations MUST be scoped to the endpoint they were
  made on.
- **FR-111**: A provider MUST be able to declare schema keywords its constrained
  decoder cannot honour; the SDK MUST omit them from the schema sent for
  server-enforced tiers and MUST report that it did.
- **FR-112**: The application's full schema MUST remain the validator in every
  case. Adaptation changes what the model is *told*, never what is *accepted*.
- **FR-113**: Where a provider streams one mechanism incrementally and another
  as a single chunk, the incremental one MUST be attempted first.

**Frame creation**

- **FR-114**: A mechanism that ends without producing any document text, before
  any document frame was sent, MUST cause a downgrade to the next mechanism
  where one exists, reported like any other downgrade.
- **FR-115**: The opening frame MUST name the mechanism that produced the
  document, also after such a downgrade.
- **FR-116**: A forced tool call answered as plain message text MUST be read
  from that text rather than regenerated.
- **FR-117**: Every failure of a streaming generation, including one raised
  before the upstream request, MUST arrive as a single `error` frame carrying
  its own error code.

**Tooling and demonstration**

- **FR-118**: A command-line inspector MUST run one generation against a chosen
  provider, print each frame, and assert the wire contract's sequencing rules
  and that replaying the frames reproduces the completed value.
- **FR-119**: A committed script MUST record a video of the reference
  application generating against a local model, reproducibly.
- **FR-120**: The React hook MUST let an application observe each frame.
- **FR-121**: The reference application MUST be able to display the frames of
  the current generation, and MUST state the provider and whether it is
  sovereign.

**Decoupling**

- **FR-122**: The generation functions and the route adapter MUST depend on an
  inference interface, not on a concrete client, so an application can supply
  its own implementation.
- **FR-123**: Applications written against feature 001's client MUST continue
  to work unchanged.

### Non-Functional

- **NFR-101**: No new runtime dependency in any package.
- **NFR-102**: Core's platform surface is unchanged (Constitution V).
- **NFR-103**: The wire protocol stays at version 1; every change is additive.
- **NFR-104**: The feature's behaviour MUST be verifiable without a network and
  without a model, and MUST additionally be verified against a real local model.

### Key Entities

- **Provider Profile** — the description of one kind of endpoint (FR-101).
- **Inference Client** — the interface the engine drives: list models, complete,
  stream, and expose capabilities and the provider.
- **Schema Dialect** — the keywords an endpoint's constrained decoder cannot
  honour.
- **Wire Schema** — the JSON Schema actually sent for a server-enforced tier:
  the application's schema, adapted to the endpoint's dialect.
- **Frame Log** — the ordered frames of one generation, as observed by the
  inspector or the reference application.

---

## Out of Scope

- Endpoints that are not OpenAI-compatible on the wire (Anthropic Messages,
  Ollama's native `/api/chat`). The interface admits them; no adapter ships.
- Automatic fail-over between providers. Sending a prompt to a second endpoint
  because the first was unavailable is precisely the surprise Principle I forbids.
- Pulling, loading or managing local models.
- Audio narration for the video.
- Measuring relaxAI's capability priors against the live API (still T-056c).

---

## Success Criteria

- With Ollama running and no relaxAI key anywhere, `RELAX_UI_PROVIDER=ollama`
  plus the reference app's dev command yields a streamed, validated dashboard.
- Against a local model, a generation produces a multi-frame stream rather than
  a single snapshot.
- Feature 001's test suite passes without modification to its assertions about
  relaxAI behaviour.
- Every refusal in Acceptance Scenarios 3, 4 and 10 has an automated test that
  asserts the refusal.
- The video can be regenerated with one command.

---

## Review Checklist

- [x] No implementation detail in requirements (libraries, file layout, APIs)
- [x] Every requirement is testable
- [x] Acceptance scenarios cover the refusal paths, not only the happy path
- [x] Ambiguities resolved in Clarifications; no markers remain
- [x] Scope explicitly bounded
- [x] Constitution principles I–VII all traceable to at least one requirement
