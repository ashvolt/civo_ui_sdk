# Technical diagrams

Mermaid, so they live in version control, diff in a pull request, and render on
GitHub without a build step.

| Diagram | What it shows |
|---|---|
| [Context](./01-context.md) | The systems involved and where the credential lives |
| [Containers](./02-containers.md) | Packages, modules and dependency direction |
| [Structuring ladder](./03-structuring-ladder.md) | Capability negotiation and downgrade |
| [Streaming pipeline](./04-streaming-pipeline.md) | Tokens to validated frames |
| [Request lifecycle](./05-request-lifecycle.md) | End-to-end sequence, including failure branches |
| [Trust boundaries](./06-trust-boundaries.md) | Threat model and where each control sits |
| [Partial JSON state machine](./07-partial-json-state.md) | The scanner that makes streaming possible |
| [Schema derivation](./08-schema-derivation.md) | One declaration, four consumers |

Each diagram is accompanied by the prose that makes it worth having. A diagram
that needs no explanation is usually not showing a mechanism.
