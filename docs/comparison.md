# How this compares

**Date**: 2026-11-10. This is a fast-moving field: check each project's own
documentation before relying on a detail here.

## Is generative UI built into React, Angular or Vue?

No. None of the three frameworks ships a generative UI feature. What exists are
libraries and protocols built on top of them, mostly in the last eighteen
months. The ones this SDK is most often compared with are below.

| Project | What it is | Hosts | How the UI is described |
|---|---|---|---|
| **Vercel AI SDK** ([docs](https://ai-sdk.dev/docs/introduction)) | A TypeScript toolkit for calling models, with UI hooks | React first; Vue, Svelte and Angular have chat and structured-object helpers ([reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui)) | Tool calls rendered as your components, or a streamed object (`useObject`). Its React Server Components route (`streamUI`) is marked experimental |
| **json-render** (Vercel Labs) ([repo](https://github.com/vercel-labs/json-render)) | A catalog of components and actions, defined with Zod; the model emits a JSON spec constrained to it | React, React Native | JSON spec against your catalog. Described by Vercel as experimental ([InfoQ](https://www.infoq.com/news/2026/03/vercel-json-render)) |
| **A2UI** (Google) ([announcement](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/)) | An open, declarative protocol for agent-driven UI: a component tree and a data model, drawn by the client's own design system | Lit, Angular and Flutter renderers; React through CopilotKit | Declarative JSON messages |
| **CopilotKit / AG-UI** ([repo](https://github.com/copilotkit/copilotkit), [guide](https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026)) | An agent front-end stack and the AG-UI event protocol between agent and app | React, Angular, Vue, React Native ([Angular docs](https://docs.copilotkit.ai/angular/concepts/generative-ui-overview)) | Three kinds: components bound to tools, declarative (A2UI), open-ended (MCP Apps in a sandboxed iframe) |
| **Hashbrown** ([docs](https://hashbrown.dev/docs/angular/start/intro)) | A headless framework for generative UI and in-app assistants | Angular, React | The model chooses among components you expose; it also runs model-written JavaScript in a sandboxed runtime |
| **Thesys C1** ([docs](https://docs.thesys.dev/)) | A hosted, OpenAI-compatible API whose responses are UI specs, with a React SDK and its Crayon component library | React | Its own JSON DSL, drawn by Crayon |

## Where this SDK is different

The others mostly start from a chat or an agent and render what it decides.
This SDK starts from the rule that **model output is untrusted input**
(Constitution IV), and from a deployment constraint, UK-sovereign inference on
relaxAI. Everything below follows from those two.

| | This SDK | Typical elsewhere |
|---|---|---|
| **Where the contract is enforced** | Twice, from one declaration: on the server, frame by frame, with fail-fast and repair; and in the browser, in full, for any source that is not the page's own origin ([ADR-0001](./adr/0001-server-side-validation-boundary.md), [ADR-0011](./adr/0011-same-origin-trust-boundary.md)) | One side: the server (tool-call schemas) or the client (catalog validation) |
| **Untrusted sources** | A static document, another service's stream, or a WebSocket is validated in full. Asking to skip that is an error, not a silent downgrade | Usually assumes the app's own backend produced the UI |
| **What reaches the DOM** | Text is always text. Tags and attributes pass allowlists, URLs pass the guard again at render time, and no model output is ever executed. Every example runs under `script-src 'self'` | Ranges from escaped components to sandboxed iframes (MCP Apps) and sandboxed code execution (Hashbrown) |
| **Hosts** | One standard Web Component, `<gen-ui>`, for plain HTML, Angular and Vue with no framework package, plus a React renderer. The same document is tested to produce identical markup in all four | A package per framework, or React only |
| **Your design system** | Connectors for all three kinds of library: class-based (Bootstrap) as a declarative mapping; Web Components (Shoelace) as the library's own elements; framework components (MUI, Angular Material, Element Plus) mounted per node. Anything unmapped falls back to a base theme, and that is reported | Map catalog entries to your components in one framework; A2UI is the closest in spirit |
| **Streaming** | JSON Patch frames with structural sharing, so the renderer updates only what changed. A component's code starts loading when its type name first arrives | Streamed objects re-rendered whole, or tool results once complete |
| **Weight** | A page with `<gen-ui>` and no document loads 13.6 KB gzip and no component code; each connector is about 1.9 KB | Varies; chat UIs and agent clients are typically larger |
| **Models** | Any OpenAI-compatible endpoint, with structuring negotiated per model (constrained decoding, tool call, or prompted JSON) and a sovereignty guard on the endpoint. Runs on local open-weight models | Usually tied to providers with strong tool calling or structured output |

## Where others are ahead

Being specific about this is the point of the comparison.

- **Interaction.** The twelve components are read-only. json-render, A2UI and
  CopilotKit already define actions and data bindings, so a generated form can
  do something. Here that is a later feature.
- **Chat and agents.** CopilotKit, Hashbrown and the AI SDK come with
  conversation state, tools in the browser, human-in-the-loop and threads. This
  SDK renders documents; it is not a chat framework.
- **A shared protocol.** A2UI and AG-UI are becoming common ground between
  agent frameworks. This SDK has its own wire protocol, version 1; it does not
  read A2UI messages yet.
- **Native and mobile.** A2UI has a Flutter renderer and json-render a React
  Native one. This SDK is web only.
- **Maturity.** The others are published, used and documented by teams. This
  SDK is tested (736 unit tests, 42 browser tests) but not yet published.

## When to use which

- **Generated documents from your own, possibly sovereign, model, rendered
  safely in an existing design system in any web framework, including several
  frameworks at once:** this SDK.
- **A conversational agent whose answers include components:** CopilotKit,
  the AI SDK, or Hashbrown; A2UI where the agent and the client are separate
  systems.
- **A React app where the model assembles screens from your shadcn components,
  including actions:** json-render.
- **A hosted service that turns prompts into UI, React only:** Thesys C1.

These are not exclusive. This SDK's contract, trust tiers and connectors could
sit beneath an A2UI or AG-UI front end. Reading A2UI messages into the contract
is the most useful next step for interoperability.
