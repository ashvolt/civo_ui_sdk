# Feature Specification: Pluggable Generative UI

**Feature Branch**: `003-pluggable-generative-ui`
**Created**: 2026-11-09
**Status**: In progress — phases 1 (protocol and inputs) and 2 (contract and base theme) implemented; phases 3–5 outstanding
**Input**: "Can this SDK become a plugin, MFE or library that drops into any
system, with selectable themes the way Angular Material has them, while staying
lightweight — lazy loading, performance and size in mind — taking a JSON
document or a stream of JSON as input to produce the generative UI?"

---

## Context

Features 001 and 002 produced a generative UI pipeline whose server half is
framework-neutral and whose browser half is React-only:

| Today | Consequence |
|---|---|
| The renderer is a React component | Angular, Vue, vanilla and micro-frontend hosts cannot render a document |
| Component implementations are supplied by each application, with inline styles in the reference app | There is no notion of a theme, and nothing to switch |
| The stream reader lives in the React package, the protocol in core beside the server client | A browser that only renders pulls in packaging it does not need |
| The hook accepts an endpoint URL only | A WebSocket, a worker or the host's own transport cannot feed it |
| Every component is bundled eagerly, and props are re-validated with Zod in the browser | First load pays for components the model may never use, and for the validator |

A static JSON document can already be rendered in React by passing it as the
renderer's `node`. That is the one part of the request that works today.

This feature makes the browser half as portable as the server half: one
standard component contract, rendered in any framework, styled by any theme
library, fed from any source, loaded only as needed.

---

## Clarifications

### Session 2026-11-09

- Q: How do non-React hosts render a document?
  → **A: A standard Web Component first.** One element works in Angular, Vue,
  vanilla pages and micro-frontends without a per-framework build. Native
  framework adapters are not part of this feature. (Drives FR-220..223.)

- Q: How are themes provided?
  → **A: A base theme of our own, plus a generic connector that can attach any
  theme library** — Bootstrap, Material and others — rather than a fixed set of
  hand-built theme packs. (Drives FR-230..238.)

- Q: Which kinds of theme library must the connector support?
  → **A: All three kinds**: libraries that style plain HTML with class names
  (Bootstrap, Bulma, Tailwind, Pico); libraries shipped as Web Components
  (Material Web, Shoelace / Web Awesome, Fluent UI web components); and
  libraries shipped as framework components (Angular Material, MUI, Vuetify).
  (Drives FR-233..236.)

- Q: For framework component libraries, which frameworks?
  → **A: React, Angular and Vue.** (Drives FR-236.)

- Q: What is the standard component contract?
  → **A: Twelve components, extensible by the application.** Layout: Stack,
  Grid, Card. Content: Heading, Text, Metric, List, Table, Callout, Badge, Link.
  Data: Chart. (Drives FR-210..214.)

- Q: Does the contract include interactive components — forms, buttons that act,
  dialogs?
  → **A: No.** The twelve are read-only; Link navigates and does nothing else.
  Interaction needs its own event contract and security design and is a later
  feature. (Drives FR-213, Out of Scope.)

- Q: How are components loaded?
  → **A: Lazily by default.** A component's code is fetched the first time a
  document uses it, and fetching starts as soon as its type name has streamed
  in — before its props have. (Drives FR-240..243.)

- Q: Which input sources must the renderer accept?
  → **A: Four**: a complete JSON document; the server-sent event stream from the
  SDK's own route; any readable byte stream; and a WebSocket. (Drives
  FR-201..205.)

- Q: Is a document received in the browser validated there?
  → **A: Tiered.** A document or stream from any source other than the SDK's own
  route is always validated in full in the browser. Validation may be skipped
  only for the SDK's own route, whose frames were validated on the server before
  they were sent. (Drives FR-206..208.)

- Q: Are size limits enforced?
  → **A: Reported, not enforced.** Every build reports the size of each package
  and lazily loaded component; none fails the build. Enforcement may be
  revisited before publishing. (Drives NFR-201.)

- Q: How is it delivered?
  → **A: One specification, released in phases**, each usable on its own:
  inputs and protocol, then contract and base theme, then lazy loading and
  tiered validation, then the Web Component with class-based and
  Web-Component-based connectors, then framework connectors. (Drives the plan's
  phase order.)

- Q: Is anything published to a package registry?
  → **A: Not in this feature.** Packages are built and consumed inside the
  repository; names are provisional. (Out of Scope.)

*No `[NEEDS CLARIFICATION]` markers remain.*

---

## User Scenarios & Testing

### Primary User Story

Meera leads the frontend platform team of a bank. The bank runs a
micro-frontend shell in Angular, a React customer portal, and a few internal
tools in plain HTML with Bootstrap. Each surface follows its own design system:
Angular Material in the shell, MUI in the portal, Bootstrap in the tools.

She wants generative screens — a statement summary, a risk overview — available
on all three, without three implementations and without the generated screens
looking foreign on any of them. Her constraints:

- the portal's performance budget is already spent; the feature must not add
  noticeable weight to pages that never show a generated screen, and only a
  little to those that do;
- the shell loads micro-frontends from separately deployed bundles, so the
  generated UI must arrive as something any of them can host, with its styles
  isolated;
- some generated documents arrive over the bank's existing WebSocket, not over
  HTTP;
- security will not accept a browser rendering JSON it has not checked.

With this feature she declares nothing new about components — the standard
contract already exists. For each surface she connects the design system it
already uses, places one element where the generated screen should appear, and
points it at a source. Each surface renders the same document in its own look,
and fetches only the components that document uses.

### Acceptance Scenarios

1. **Given** a complete JSON document that satisfies the standard contract,
   **When** it is given to the renderer in any supported host,
   **Then** it is validated in the browser and rendered, with no server
   involved.

2. **Given** the same document with one node whose type is not in the contract,
   **When** it is rendered from a static input,
   **Then** that node renders nothing (or the host's chosen fallback) and the
   rest of the document renders.

3. **Given** a WebSocket delivering the SDK's stream frames,
   **When** it is given to the renderer as its source,
   **Then** the document builds up as frames arrive, exactly as it does over the
   SDK's own route.

4. **Given** the SDK's own route as the source and validation set to trust the
   server,
   **When** a document streams in,
   **Then** no browser-side schema validation runs and the validator's code is
   not loaded.

5. **Given** any source other than the SDK's own route,
   **When** the host attempts to switch browser validation off,
   **Then** the renderer refuses, and the document is validated in full.

6. **Given** an Angular application, a Vue application and a plain HTML page,
   **When** each places the Web Component and points it at the same source,
   **Then** each renders the same document without any framework-specific
   package.

7. **Given** the base theme and a page that switches between its light, dark and
   compact variants,
   **When** the variant changes,
   **Then** the rendered document restyles without being re-rendered or
   re-fetched.

8. **Given** a connector for a class-based library such as Bootstrap,
   **When** a document is rendered,
   **Then** every component uses that library's markup conventions and classes,
   and the page needs no stylesheet from this SDK beyond what the connector
   declares.

9. **Given** a connector for a Web-Component library such as Material Web or
   Shoelace,
   **When** a document is rendered,
   **Then** components are rendered as that library's elements.

10. **Given** a connector for a framework component library — Angular Material
    in Angular, MUI in React, a Vue library in Vue,
    **When** a document is rendered in that framework,
    **Then** components are that library's own components.

11. **Given** a connector that implements only some of the twelve components,
    **When** a document uses one it does not implement,
    **Then** that component falls back to the base theme's implementation, and
    the fallback is reported to the host.

12. **Given** a document that uses Stack, Metric and Text only,
    **When** it is rendered with lazy loading,
    **Then** the code for Table, Chart and the other unused components is never
    fetched.

13. **Given** a stream in which a Chart node's type has arrived but its props
    have not,
    **When** the renderer sees the type,
    **Then** the Chart component's code starts loading immediately.

14. **Given** an application that registers its own component in addition to
    the twelve,
    **When** the server generates a document using it,
    **Then** it validates and renders like any standard component, and every
    connector without an implementation for it falls back as in scenario 11.

15. **Given** two Web Components on one page with different themes, both in
    isolated mode,
    **When** both render,
    **Then** neither theme's styles affect the other or the host page.

16. **Given** a build of the packages,
    **When** it completes,
    **Then** it reports the compressed size of each package and of each lazily
    loaded component, alongside the previous build's figures.

### Edge Cases

- **A component's code fails to load** (network error, blocked chunk): that node
  shows the host's fallback; the rest of the document renders; the failure is
  reported. A later frame does not retry indefinitely.
- **A theme library is not present on the page** although its connector is
  selected: a configuration error naming the missing library, not a blank
  screen.
- **A WebSocket closes mid-document**: the renderer reports an incomplete
  document. It does not present the partial document as finished.
- **A WebSocket carries messages for several documents**: out of scope for the
  renderer; the host demultiplexes and gives each renderer its own stream.
- **A static document is very large or very deep**: the same node and depth
  budgets as feature 001 apply in the browser.
- **The host page has a strict Content Security Policy**: lazy loading and the
  Web Component work without `unsafe-eval` or `unsafe-inline` script.
- **Two connectors claim the same component type**: the later one wins and the
  override is reported; nothing is merged.
- **A model generates a Link to a disallowed URL**: refused at validation time,
  as in feature 001, whichever connector renders it.

---

## Requirements

Numbered from 201 so they cannot be confused with features 001 and 002.

### Functional

**Input**

- **FR-201**: The renderer MUST accept a complete document as input.
- **FR-202**: The renderer MUST accept the SDK's own event stream from its route.
- **FR-203**: The renderer MUST accept any readable byte stream carrying the
  SDK's event stream format.
- **FR-204**: The renderer MUST accept a WebSocket whose messages carry the
  SDK's events.
- **FR-205**: Every streaming source MUST be rendered by the same accumulation
  logic, with the same sequencing guarantees as protocol version 1.

**Validation in the browser**

- **FR-206**: A document or stream from any source other than the SDK's own
  route MUST be validated in full against the contract before any node is
  rendered.
- **FR-207**: Browser validation MAY be switched off only for a source that is
  an http(s) URL of the page's own origin, and only when the host asks. An
  attempt to switch it off for any other source MUST be refused. *(Revised in
  planning — see below.)*
- **FR-208**: When validation is off, the validator's code MUST NOT be loaded.

**Standard contract**

- **FR-210**: The SDK MUST define a standard contract of twelve components:
  Stack, Grid, Card, Heading, Text, Metric, List, Table, Callout, Badge, Link,
  Chart.
- **FR-211**: The contract MUST be the single source for server-side schema
  derivation and browser-side validation (feature 001, FR-002).
- **FR-212**: An application MUST be able to add components to the contract and
  to override a standard component's schema for its own use.
- **FR-213**: No component in the standard contract MAY execute an action. Link
  MAY navigate and MUST be subject to the URL guard of feature 001.
- **FR-214**: Each component in the contract MUST state its props, whether it
  takes children, and the semantic role a theme must give it (for accessibility).

**Rendering in any host**

- **FR-220**: The SDK MUST provide a standard Web Component that renders a
  document from any supported input.
- **FR-221**: The Web Component MUST work in Angular, Vue and plain HTML without
  a framework-specific package.
- **FR-222**: The Web Component MUST offer an isolated mode, used by default,
  whose styles neither affect nor are affected by the host page or other
  instances. It MAY offer a non-isolated mode for theme libraries whose styles
  are global, scoped to the component's own container; framework connectors
  MUST use it. *(Revised in planning — see below.)*
- **FR-223**: The Web Component MUST report the same states as the existing
  React hook — streaming, complete, error, provider, strategy — to its host.
- **FR-224**: The existing React renderer MUST keep working and MUST render
  through the same contract and connectors.

**Themes and connectors**

- **FR-230**: The SDK MUST provide a base theme implementing all twelve
  components.
- **FR-231**: The base theme MUST be styled through named design tokens, so that
  colour, typography, spacing, radius and density can be changed without code.
- **FR-232**: The base theme MUST provide light, dark and compact variants,
  switchable at runtime without re-rendering.
- **FR-233**: The SDK MUST provide one connector interface through which any
  theme library is attached.
- **FR-234**: The connector MUST support libraries that style plain HTML with
  class names, without code beyond a declarative mapping.
- **FR-235**: The connector MUST support libraries shipped as Web Components.
- **FR-236**: The connector MUST support framework component libraries in React,
  Angular and Vue.
- **FR-237**: A component a connector does not implement MUST fall back to the
  base theme's implementation, and the fallback MUST be reported.
- **FR-238**: A connector MUST NOT be able to render a node outside the
  contract, nor bypass prop validation, nor render model output as markup.

**Loading and size**

- **FR-240**: Component implementations MUST be loaded on first use by default.
- **FR-241**: Loading of a component MUST begin when its type is first seen in
  a stream, before its props are complete.
- **FR-242**: A page that never renders a document MUST NOT load any
  component implementation.
- **FR-243**: A host MUST be able to preload chosen components eagerly.
- **FR-244**: A component that fails to load MUST be reported and rendered as
  the host's fallback, without affecting the rest of the document.

### Non-Functional

- **NFR-201**: Every build MUST report the compressed size of each package and
  each lazily loaded component, and the change from the previous build. Size
  limits are reported, not enforced.
- **NFR-202**: The browser-side protocol package MUST have no runtime
  dependency.
- **NFR-203**: Nothing in this feature MAY add a runtime dependency to core
  (Constitution V). Connector packages MAY declare their framework or theme
  library as a peer dependency.
- **NFR-204**: Rendering MUST work under a Content Security Policy without
  `unsafe-eval` or `unsafe-inline` script.
- **NFR-205**: Each of the twelve components in the base theme MUST meet WCAG
  2.2 AA for contrast and keyboard access in all three variants.
- **NFR-206**: Applications written against features 001 and 002 MUST continue
  to work unchanged.
- **NFR-207**: The wire protocol MUST remain at version 1.

### Key Entities

- **Component Contract** — the standard twelve plus application additions:
  names, prop schemas, children policy, semantic role.
- **Document Source** — where a document comes from: static, SDK route, byte
  stream, WebSocket; and whether it is trusted to skip browser validation.
- **Theme** — design tokens plus implementations of the contract.
- **Connector** — the mapping from the contract onto one theme library, of one
  of three kinds: class-based, Web-Component-based, framework-based.
- **Component Catalog** — which implementation renders each type, and whether it
  is loaded eagerly or lazily.
- **Size Report** — per-package and per-component compressed sizes for one
  build, with the change from the previous one.

---

## Planning revisions

Research contradicted two requirements as first written. Both are revised above
and recorded here so the change is visible.

| Item | First written | Revised | Reason |
|---|---|---|---|
| FR-207 | validation may be skipped "only for the SDK's own route" | only for a **same-origin URL** source, on request | A browser cannot prove a stream came from the SDK; every signal is forgeable by the page. Origin is the only boundary that means something ([research R4](./research.md)) |
| FR-222, scenario 15 | styles MUST be isolated | isolated mode is the default; a container-scoped mode is permitted, and required for framework connectors | Global theme libraries (Bootstrap's stylesheet, Angular Material's head-injected styles) cannot reach inside a shadow root ([research R3](./research.md)) |

---

## Constitution impact

This feature cannot be planned under v1.1.0 as written. Two clarifications are
needed, both expected to be MINOR:

- **Principle IV** says validation, guarding and parsing happen on the server.
  A static document or a WebSocket is data that never passed through the SDK's
  server. The principle needs to say what the browser must do then — validate
  in full — rather than be read as forbidding such input.
- **Principle V** forbids runtime dependencies in core. It should state
  explicitly that connector packages may take their framework or theme library
  as a peer dependency, and that the browser protocol package may take none.

Done in planning: constitution **v1.2.0**. Both principles gained obligations;
neither lost one.

---

## Out of Scope

- Interactive components: forms, buttons with actions, dialogs, tabs.
- Native framework adapters for rendering (as opposed to framework connectors
  for theme libraries). The Web Component is the rendering path for non-React
  hosts.
- Chat mode: conversation state, multiple turns, text and UI in one answer.
- Publishing to a package registry, and final package names.
- Enforced size limits.
- A micro-frontend runtime. The Web Component works with any module federation
  or import-map setup; choosing one is the host's concern.
- Server-side rendering of the Web Component.

---

## Success Criteria

- The same document renders in React, Angular, Vue and a plain HTML page, in
  each case styled by that host's existing theme library.
- Switching between the base theme's light, dark and compact variants restyles
  a rendered document without re-rendering it.
- A page that never shows a generated screen loads no component code.
- A document using three of the twelve components loads the code for those three
  and no others.
- A document from a non-SDK source cannot be rendered without browser
  validation.
- Every build publishes a size report.
- Features 001 and 002's test suites pass unmodified.

---

## Review Checklist

- [x] No implementation detail in requirements (libraries, file layout, APIs)
- [x] Every requirement is testable
- [x] Acceptance scenarios cover the refusal paths, not only the happy path
- [x] Ambiguities resolved in Clarifications; no markers remain
- [x] Scope explicitly bounded
- [x] Constitution impact identified before planning
