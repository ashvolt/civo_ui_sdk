# Feature Specification: Generative UI SDK for relaxAI

**Feature Branch**: `001-generative-ui-sdk`
**Created**: 2026-09-29
**Status**: Implemented
**Input**: "Enterprise frontend teams should be able to stream and render complex
generative UI from relaxAI safely, with strict schema validation, without
writing the plumbing themselves."

---

## Clarifications

### Session 2026-09-29

- Q: Does the browser ever receive raw model tokens?
  → **A: No.** Parsing, validation and guarding happen server-side. The browser
  receives typed events describing a validated object taking shape. This is a
  hard boundary, not a default. (Drives FR-011, FR-020, NFR-004.)

- Q: What happens when a model does not support constrained decoding?
  → **A: Degrade automatically and report it.** The SDK tries the strongest
  mechanism the model is believed to support and walks down a ladder on
  rejection. The degradation appears in result metadata. (Drives FR-004..007.)

- Q: What counts as "valid" mid-stream, when the object is incomplete by
  definition?
  → **A: Two classes of issue.** "Not written yet" (missing required key, short
  string, half-spelled enum) is tolerated while the stream is open and fatal at
  close. "Wrong shape" (wrong type, unknown key, over-long value) is fatal
  immediately. (Drives FR-009, FR-010.)

- Q: Can an application let the model choose which component to render from a
  general vocabulary, e.g. any HTML element?
  → **A: No.** The renderable set is closed at schema-construction time from the
  application's own registration. (Drives FR-013..016.)

- Q: Should the SDK ship telemetry so teams can see downgrade rates?
  → **A: In-process only.** Counters and callbacks, no transport. Anything
  leaving the process is the application's explicit act. (Drives NFR-005.)

- Q: Which Zod major does the SDK target?
  → **A: Both 3 and 4.** Enterprise codebases will not move majors to adopt an
  SDK. (Drives NFR-007.)

*No `[NEEDS CLARIFICATION]` markers remain.*

---

## User Scenarios & Testing

### Primary User Story

Priya is a senior frontend engineer at a UK insurer. Her team is building an
internal claims-analytics console. Leadership wants the console to answer
free-text questions with a **laid-out view** — headline figures, a ranked list,
a short written takeaway — rather than a wall of chat text, and the view should
differ depending on what was asked.

The insurer cannot send claims data to a US hyperscaler's model API. They have
chosen Civo relaxAI: UK data centres, UK legal jurisdiction, OpenAI-compatible.

Priya's problem is not access to a model. It is everything between the model and
a rendered component:

- The models on relaxAI are open-weight. Some support constrained JSON decoding;
  some only tool calling; some neither. Her code cannot assume.
- Her reviewers will not accept rendering model-authored markup.
- Streaming is a product requirement — a four-second blank screen reads as
  broken — but a half-written JSON document cannot be parsed, and the natural
  workaround (wait for the last token) throws the requirement away.
- She has a Zod schema already. She does not want a second, hand-maintained
  JSON Schema that will drift from it.

With this SDK she declares her component vocabulary once, exports one route
handler, and calls one hook. The layout streams in, every node is validated
before it renders, nothing outside her vocabulary can appear, and if the model
gets the shape wrong she gets a typed error rather than a broken page.

### Acceptance Scenarios

1. **Given** an application that has registered a component vocabulary,
   **When** it requests a UI document for a user's question,
   **Then** it receives an object matching its schema, or a typed error — never
   an unvalidated value.

2. **Given** a model that supports constrained JSON decoding,
   **When** a document is generated,
   **Then** the SDK uses the server's native schema enforcement and reports
   `native_json_schema` as the strategy.

3. **Given** a model whose server rejects `response_format: json_schema`,
   **When** a document is generated,
   **Then** the SDK retries via tool calling without the caller intervening,
   succeeds, reports the downgrade in metadata, and does not repeat the rejected
   attempt on the next request in the same process.

4. **Given** a streaming generation,
   **When** the model has emitted `{"title":"Quarterly rev`,
   **Then** the client's object contains `title: "Quarterly rev"` and no
   `title` key appears half-named or mis-typed at any point in the stream.

5. **Given** a streaming generation where the model emits a value of the wrong
   type early on,
   **When** the SDK detects the violation,
   **Then** the stream ends with a typed error at that point rather than after
   the remaining tokens are generated and paid for.

6. **Given** a model that returns `<think>…</think>` before its answer, wrapped
   in a markdown fence, with a sentence of commentary after it,
   **When** the document is parsed,
   **Then** the reasoning, fence and commentary are stripped and the JSON is
   extracted successfully.

7. **Given** a generated document naming a component the application never
   registered,
   **When** it is validated,
   **Then** validation fails; and if such a node somehow reaches the renderer, it
   renders nothing rather than guessing.

8. **Given** a generated document containing `href: "javascript:alert(1)"`,
   **When** it is validated,
   **Then** validation fails at the schema layer — before any render — and the
   renderer independently refuses it as well.

9. **Given** an application configured with a `baseURL` outside its sovereignty
   allowlist,
   **When** the client is constructed,
   **Then** construction throws, before any prompt is sent.

10. **Given** a first generation that fails schema validation,
    **When** repair is enabled,
    **Then** the SDK re-asks once, showing the model its own output and the
    specific validation failures, and returns the corrected object.

11. **Given** a user who closes the tab mid-generation,
    **When** the request is aborted,
    **Then** the upstream inference request is cancelled rather than run to
    completion.

12. **Given** a route handler,
    **When** a request body contains `model` or `system` fields,
    **Then** they are discarded by input validation and cannot influence which
    model runs or what the system prompt says.

### Edge Cases

- **Stream truncates mid-document** (`max_tokens`, upstream reset): the SDK
  repairs off-stream and replaces the document, or fails with a typed error.
  It never presents a truncated object as complete.
- **Model emits a 200,000-node tree**: rejected by the document budget, and the
  budget check itself must not overflow the stack while measuring.
- **Model emits a trailing comma / unterminated escape / partial `\uXXXX`**:
  the partial parser rewinds to the last committed member.
- **Server sends keep-alive comments or vendor frames in the event stream**:
  skipped, not fatal.
- **Frames arrive out of order**: the client refuses to render a mixture and
  raises, rather than silently displaying a document neither side agrees on.
- **Model is an embeddings model**: rejected before a request is spent.
- **Two components in the registry share a prop name with different types**:
  each node is validated against its own component's schema only.

---

## Requirements

### Functional

**Structured generation**

- **FR-001**: The SDK MUST return, for a given schema, either a value that has
  passed that schema or a typed error.
- **FR-002**: The SDK MUST derive the JSON Schema sent to the model from the
  application's runtime schema, and MUST NOT require the application to maintain
  a second copy.
- **FR-003**: Where derivation is not possible for a construct, the SDK MUST
  fail explicitly and offer an override, rather than emit an approximation.

**Capability negotiation**

- **FR-004**: The SDK MUST select a structuring mechanism based on inspectable,
  overridable per-model capability data.
- **FR-005**: The SDK MUST attempt the strongest available mechanism first.
- **FR-006**: On a server rejection indicating the mechanism is unsupported, the
  SDK MUST retry with the next mechanism without caller involvement.
- **FR-007**: A degradation MUST be reported in result metadata and MUST be
  remembered for the process lifetime.
- **FR-008**: The SDK MUST NOT degrade in response to an error that is not a
  capability rejection (auth failure, rate limit, bad request).

**Streaming**

- **FR-009**: While a stream is open, issues that mean "not written yet" MUST be
  tolerated.
- **FR-010**: Issues that mean "wrong shape" MUST end the stream immediately
  with a typed error.
- **FR-011**: The browser MUST receive typed events describing a validated
  object, never raw model tokens.
- **FR-012**: The stream MUST support incremental updates rather than
  re-transmitting the whole document per frame, and MUST support a snapshot mode
  for debuggability.

**Generative UI safety**

- **FR-013**: The set of renderable component types MUST be closed at
  schema-construction time from the application's registration.
- **FR-014**: Each node's props MUST be validated against that component's own
  schema.
- **FR-015**: URL-bearing props MUST be validated against a scheme (and
  optionally host) allowlist at schema-validation time.
- **FR-016**: The renderer MUST NOT provide any path from model output to raw
  HTML.
- **FR-017**: Document node count and depth MUST be bounded, and the bound MUST
  be enforceable against a document deep enough to overflow a recursive walk.

**Sovereignty and privacy**

- **FR-018**: The client MUST refuse a base URL whose host is not allowlisted,
  at construction time.
- **FR-019**: The client MUST refuse plaintext HTTP except for an explicitly
  opted-in loopback host.
- **FR-020**: The SDK MUST NOT make any network request the application did not
  ask for.
- **FR-021**: Deterministic outbound prompt redaction MUST be available and
  reportable.
- **FR-022**: Error payloads crossing a process or network boundary MUST NOT
  carry prompt or completion text.

**Integration**

- **FR-023**: A Next.js App Router handler MUST be constructible in one call.
- **FR-024**: The model, schema, system prompt and sampling parameters MUST be
  fixed by the application, not supplied by the browser.
- **FR-025**: Caller cancellation MUST propagate to the upstream request.
- **FR-026**: A React hook MUST expose the streaming object, completion state,
  typed errors and generation metadata.

### Non-Functional

- **NFR-001**: Core MUST have zero runtime dependencies beyond the caller's
  schema library.
- **NFR-002**: Core MUST run unchanged on Node ≥ 20, the Vercel Edge runtime,
  Cloudflare Workers, Bun and Deno.
- **NFR-003**: Core MUST NOT import any `node:` module.
- **NFR-004**: Model-output parsing and guarding MUST happen server-side.
- **NFR-005**: Observability MUST be in-process only: callbacks and counters,
  no transport.
- **NFR-006**: Every failure MUST carry a stable machine-readable code.
- **NFR-007**: The SDK MUST work with both Zod 3 and Zod 4.
- **NFR-008**: Streaming a document MUST NOT cost bandwidth quadratic in
  document size.

### Key Entities

- **Structured Schema** — a named schema plus its derived JSON Schema; the unit
  a generation targets.
- **Model Capabilities** — what a given model can be relied on to do.
- **Structuring Strategy** — a mechanism for obtaining schema-conformant JSON,
  ordered by strength of guarantee.
- **UI Registry** — an application's closed component vocabulary; source of the
  model-facing schema, the validator and the renderer's lookup table.
- **UI Node** — one component instance: a type, validated props, optional
  children, optional identity key.
- **UI Stream Event** — one frame of the server-to-browser protocol.
- **Generation Metadata** — strategy used, downgrades taken, repair rounds
  spent, token usage, duration.

---

## Out of Scope

- Embeddings, audio, image and deep-research endpoints. relaxAI exposes them;
  this feature is about structured generation for UI.
- Multi-turn chat state, conversation persistence, RAG.
- Agentic tool execution. Tool calling is used here as a typed return channel,
  not to let a model take actions.
- A component library. The SDK renders the application's components; it ships
  none.
- Server-side rate limiting and quotas — the `authorize` hook is the seam.

---

## Success Criteria

- A developer with an existing Zod schema reaches a streaming, validated,
  rendered UI in under 30 lines of application code across one route and one
  component.
- A generation against a model with no constrained-decoding support succeeds
  without any application change.
- Every refusal path in *Acceptance Scenarios* 7, 8, 9 and 12 has an automated
  test asserting the refusal.
- No code path exists from model output to `dangerouslySetInnerHTML`.

---

## Review Checklist

- [x] No implementation detail in requirements (libraries, file layout, APIs)
- [x] Every requirement is testable
- [x] Acceptance scenarios cover the refusal paths, not only the happy path
- [x] Ambiguities resolved in Clarifications; no markers remain
- [x] Scope explicitly bounded
- [x] Constitution principles I–VII all traceable to at least one requirement
