# Architecture Decision Records

Eight decisions this SDK turns on. Each records the alternatives and why they were
rejected — the rejections are the useful part, because they are what a reviewer
would otherwise have to ask about.

| ADR | Decision | Principle |
|---|---|---|
| [0001](./0001-server-side-validation-boundary.md) | Parse, validate and guard model output on the server | IV |
| [0002](./0002-capability-negotiated-structuring-ladder.md) | Negotiate a three-tier structuring ladder per model | III |
| [0003](./0003-no-openai-sdk-dependency.md) | Write the HTTP client rather than depend on `openai` | I, V |
| [0004](./0004-closed-component-vocabulary.md) | Close the component vocabulary at schema-construction time | II, IV |
| [0005](./0005-streaming-partial-validation.md) | Classify validation issues instead of deriving a partial schema | II, VII |
| [0006](./0006-json-patch-streaming-transport.md) | Stream JSON Patch frames, not snapshots | V |
| [0007](./0007-provider-profiles-and-inference-interface.md) | The endpoint is a provider profile behind an inference interface | I, III, V |
| [0008](./0008-wire-schema-dialects.md) | Send a constrained decoder only what it can enforce | II, III |

Principles are from the [constitution](../../.specify/memory/constitution.md).

## Format

Context → Decision → Alternatives considered → Consequences (good and bad) →
Verification. The "bad" section is mandatory: a decision record with no
consequences it is unhappy about has not been thought through.
