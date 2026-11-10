# Phase 0 — Research

**Feature**: 003-pluggable-generative-ui
**Date**: 2026-11-09

Unlike feature 002, nothing here could be measured against a running system
yet: there is no renderer to measure. Each item states what was decided, what
was rejected, and — where a number matters — that it is an estimate to be
replaced by a measurement in phase 1 of the plan. Two items (R3, R4) changed the
spec; they are marked.

---

## R1. What the browser actually needs from today's packages

**Question**: how much of the existing code can a framework-neutral renderer
reuse?

**Findings** (from the source, not a bundle analysis):

| Piece | Where today | Browser needs it? | Dependencies |
|---|---|---|---|
| Event types, `UIStreamAccumulator` | `core/protocol.ts` | yes | none |
| JSON Patch apply | `core/stream/json-patch.ts` | yes | none |
| SSE decoder | `core/stream/sse.ts` | yes | none |
| `readUIStream` | `react/stream.ts` | yes | core only — no React, despite its package |
| `UINode`, `measureTree`, `urlString` | `core/ui/contract.ts` | yes | Zod (caller's) |
| Client, strategies, partial JSON, providers | core | **no** | — |
| Renderer | `react/renderer.tsx` | React hosts only | React |

`core` is 24.4 KB gzip as a whole (measured 2026-11-09). The browser-only subset
is the first five rows: by line count roughly a tenth of core. **Estimate: 2–3
KB gzip**, to be measured once split.

**Measured in phase 1** (T-218, `pnpm size`: esbuild, minified, gzip level 9,
2026-11-09). The method differs from the 24.4 KB figure above, which was not
minified; compare rows within this table only.

| Bundle | gzip | Notes |
|---|---:|---|
| `relax-ui-protocol`, whole package | 3.71 KB | includes the four source readers and the trust check, which the estimate did not |
| `readSource` + accumulator + `resolveValidation` | 3.28 KB | the minimum a non-React host needs |
| `relax-ui-core`, own code (protocol compiled in) | 16.96 KB | |
| React hook only, core and protocol bundled | 4.74 KB | core contributes 0.9 KB (partial validation) |
| React hook + renderer | 5.11 KB | |

The estimate was low by about 1 KB because it predates the sources. The
conclusion stands: the browser subset is a fifth of core's size.

**Decision**: extract the browser subset into a `protocol` package with no
dependencies. `core` re-exports it, so nothing that imports from `core` today
breaks (NFR-206).

**Rejected**: *rely on tree-shaking of `core`.* `core` is already marked
side-effect free and would shake reasonably, but a host that installs `core` to
render a document also installs the server client and the provider profiles, and
every bundler's shaking is a little different. A package boundary is a guarantee;
shaking is a hope.

---

## R2. How a framework-neutral renderer is built

**Question**: the Web Component needs a renderer that is not React. Write one, or
use a library?

**Options**

| | Size (gzip, estimate) | Dependency | Keyed updates during streaming |
|---|---|---|---|
| Lit | ~5–6 KB | `lit` | yes, via templates |
| Preact + custom-element wrapper | ~4–5 KB | `preact` | yes |
| Own minimal DOM reconciler | ~1.5–2.5 KB | none | must be written |

**Decision**: **own reconciler**, split into a framework-neutral *render core*
(tree walk, validation tier, catalog lookup, lazy loading, fallback reporting)
and a small DOM backend.

The reason it is affordable is a property the SDK already has. `applyPatch`
shares structure: a subtree no patch touched is the *same object* in the next
document. So the reconciler's diff is an identity check per node — unchanged
references are skipped outright — plus keyed matching of children, where the
model's `key` (or the position) identifies a node. That is a much smaller
problem than general virtual-DOM diffing.

**Rejected**:

- *Lit.* Good, and small. Rejected because the render core must also drive
  framework connectors (R5), which mount React, Angular or Vue components into
  nodes; a template library in the middle of that adds a layer without removing
  one. It stays a reasonable fallback if the own reconciler proves harder than
  estimated — phase 4 starts with a spike to decide.
- *Preact.* A second React-like runtime on a page that may already have React,
  or Angular, or Vue.

**Risk**: a hand-written reconciler is where subtle bugs live. Mitigated the way
feature 001 mitigated the partial parser: property tests that apply every prefix
of realistic streams and assert the DOM equals a from-scratch render of the same
document.

**Measured (phases 3 and 4)**: the render core and DOM backend are 3.8 KB gzip on
their own, 4.1 KB for a page with the lazy base theme. The property tests pass
in the DOM backend and inside `<gen-ui>`, and three deliberate reconciler bugs
were each caught. The spike did not need the Lit fallback.

---

## R3. Style isolation versus global theme libraries — **changes the spec**

**Question**: spec FR-222 requires the Web Component's styles to be isolated from
the host and from other instances. Can that hold for every connector kind?

**Findings**:

| Connector kind | Where the library's CSS lives | Inside a shadow root? |
|---|---|---|
| Base theme | ours | ✅ works, tokens pass through via CSS custom properties |
| Web-Component libraries (Material Web, Shoelace, Fluent) | inside each component's own shadow root; themed by CSS custom properties | ✅ works — designed for it |
| Class-based (Bootstrap, Bulma, Tailwind) | one global stylesheet | ⚠️ only if the stylesheet is also loaded *inside* the shadow root. Possible (`<link>` or constructable stylesheet), at the cost of the browser parsing it once per instance unless shared |
| Framework libraries (Angular Material, MUI, Vuetify) | global theme CSS, plus per-component styles the framework injects into `document.head` | ❌ head-injected styles never reach a shadow root |

Shadow DOM isolates in both directions. Global theme libraries are, by design,
global. The two cannot both be fully satisfied for the third and fourth rows.

**Decision**: the Web Component has two modes.

- **`shadow`** (default) — isolated; used by the base theme and Web-Component
  libraries. Class-based connectors may use it by declaring their stylesheet,
  which the element adopts once and shares between instances.
- **`light`** — renders into the host's DOM inside a scoping container, so global
  library styles apply. Required for framework connectors; optional for
  class-based ones.

**Spec change**: FR-222 and acceptance scenario 15 are revised: isolation is
required in `shadow` mode and is the default; `light` mode is permitted, and
required for framework connectors, with scoping by container rather than by
shadow root. Recorded in spec.md as a planning revision.

**Measured (phase 4)**: Bootstrap 5 works in `shadow` mode once its sheet is
adopted, with one rewrite: its custom properties are declared on `:root`, which
matches nothing in a shadow root, so the element adopts the sheet with `:root`
read as `:host`. The sheet is fetched once per page and shared by every
instance. In Chromium, four elements on one page (base theme, Bootstrap,
Shoelace, the base theme re-branded) leak no style into each other or the host
page, in either direction.

**Rejected**: *copying head-injected framework styles into each shadow root.*
Possible with a `MutationObserver` on `document.head`, and fragile: it depends on
each framework's private injection order, and breaks silently on upgrade.

---

## R4. What "the SDK's own route" means in a browser — **changes the spec**

**Question**: FR-207 lets browser validation be skipped only for the SDK's own
route. How does a renderer know a stream came from it?

**Findings**: it cannot know, cryptographically. Every check available in a
browser is something the host page could fake: a header, a `meta` frame, a URL
pattern. Signing frames would need a key in the browser, which is no key at all.

What *is* meaningful is **origin**. A same-origin URL is served by the
application that served the page; if that server is compromised, the page is
too, and browser validation would not save it. A cross-origin URL, a WebSocket,
a byte stream or a static object could have come from anywhere.

**Decision**: browser validation may be skipped only when the source is an
**http(s) URL of the page's own origin** and the host asks for it explicitly
(`validate: "server"`). Any other source with that option is refused with a
configuration error.

**Spec change**: FR-207 is made precise — "the SDK's own route" becomes "a
same-origin URL source". Recorded in spec.md.

**Accepted limitation**: same-origin is a statement about who served the
stream, not about what produced it. An application that proxies a third-party
stream through its own origin and turns validation off has made that choice
itself, in code.

---

## R5. How framework components render inside a framework-neutral element

**Question**: an Angular Material `mat-card` is an Angular component. The renderer
is not Angular. How does the card appear?

**Decision**: a **mount contract**. For each node, the render core creates a host
element and asks the catalog for an implementation. A framework connector's
implementation is a function `mount(host, props, children) → { update, unmount }`
that the connector package fills in with its framework's own API:

| Framework | Mount mechanism |
|---|---|
| React | `createRoot(host).render(<Component …/>)`, or a portal into one shared root |
| Angular | `createComponent(Type, { environmentInjector, hostElement: host })` + `appRef.attachView` |
| Vue | `createApp(Component, props).mount(host)`, or `render(h(Component), host)` |

Children are rendered by the render core into a container the parent component
exposes (a slot element), so a framework component never renders model data it
was not given by the core.

**Consequences**:

- Framework connectors need `light` mode (R3).
- Each node that uses a framework component is its own small root. For a
  12-component document of tens of nodes this is cheap; for hundreds it is not.
  The plan includes a measurement task, with batching (one root, portals) as the
  known fallback for React and Vue.
- The connector runs in the host's framework context, so it must be given that
  context once: an Angular `EnvironmentInjector`, a React root, a Vue app.

**Rejected**:

- *Native framework renderers* (an Angular `<gen-ui-ng>` that renders the whole
  tree in Angular). Better developer experience, and three more renderers to
  keep in step — explicitly out of scope by clarification.
- *Ask framework libraries for their Web-Component editions.* Where they exist
  (Material Web) this is what the Web-Component connector already does; where
  they do not (Angular Material, MUI), it is not an option.

---

## R6. Lazy loading

**Question**: how is "load on first use, start when the type arrives" done
without breaking a strict Content Security Policy?

**Decision**:

- The catalog maps each type to a loader: `() => import("./metric.js")`.
  Bundlers turn each into a separate chunk. Dynamic `import()` of same-origin
  chunks is permitted under `script-src 'self'` and needs no `unsafe-eval`.
- The render core watches each accumulated document for `type` values it has not
  seen and calls the loader **as soon as the type equals a contract name
  exactly**. A partial type (`"Met"`) matches nothing. A type that is a prefix of
  another (`"Card"` before `"CardGroup"` in an extended contract) may trigger one
  unnecessary fetch; harmless and recorded.
- Until a component has loaded, its node renders a lightweight placeholder of
  the right role, so layout does not jump twice.
- `preload: [...]` lets a host load chosen components eagerly (FR-243).
- A failed load is reported once per type per document and renders the host's
  fallback (FR-244). It is retried on the next document, not on the next frame.

**Why streaming makes this nearly free**: the type name precedes its props in
every document the model writes, because the contract puts `type` first and
constrained decoding follows key order. Fetching a 2–3 KB chunk usually
completes before the props it will render have finished streaming.

**Rejected**: *a single bundle per theme.* Simpler, and contradicts FR-242.

---

## R7. Validation in the browser, lazily

**Decision**: the validator is itself lazily loaded. A same-origin stream with
`validate: "server"` never loads it (FR-208). Any other source loads the
contract's schemas before rendering the first node.

**Cost** — estimated at 13–14 KB gzip for Zod 3; **measured 13.85 KB** (Zod
3.25, one small strict object schema, T-218). Zod 4's smaller entry point is
not yet measured. The contract package's schemas are small by
comparison. This is the single largest optional cost on the client, which is why
it is the one most worth not paying when the server already paid it.

**Rejected**: *a second, lighter validator (Valibot, precompiled JSON Schema
checks).* It would mean two descriptions of each component to keep equivalent —
the exact failure Principle II exists to prevent. Revisit only with a way to
derive one from the other.

---

## R8. Themes as design tokens

**Decision**: the base theme reads only CSS custom properties, prefixed `--gen-`:
colour roles (primary, surface, on-surface, outline, success, warning, info),
typography scale, spacing scale, radius, density. Variants are attribute
selectors on the element (`variant="dark"`, `density="compact"`), so switching
re-styles without re-rendering (FR-232).

Custom properties inherit through shadow boundaries, so a host can theme an
isolated element from outside — the mechanism Material Web and Shoelace already
use. The token names map one-to-one onto Material 3's colour roles where one
exists, so a host already using Material tokens can alias rather than restate
them.

**Rejected**: *a theme as JavaScript object.* Changes would require re-render,
and the theme would not be inspectable in devtools.

---

## R9. WebSocket and byte-stream input

**Decision**:

- **WebSocket**: one SDK event per message, the same JSON as an SSE `data:` line.
  A `complete` or `error` event, or the text `[DONE]`, ends the document. The
  renderer does not own the socket: the host passes one in, and closing the
  element stops listening without closing the socket, which may be shared.
- **Byte stream**: any `ReadableStream<Uint8Array>` in SSE framing, read by the
  existing decoder.
- **Multiplexing** several documents over one socket is the host's job (spec,
  Edge Cases).

---

## R10. Size reporting

**Decision**: a CI job builds each package and each lazy chunk with esbuild's
metafile (esbuild is already present through tsup — no new dependency), gzips
the outputs, and writes a table to the job summary with the change from the last
`main` build, cached as an artifact. Reported, never failing (NFR-201).

---

## R11. The twelve components

**Decision**: props chosen to be renderable well by every connector kind, and
bounded for the same reason feature 001 bounded strings.

| Component | Children | Props (summary) |
|---|---|---|
| Stack | required | `gap`, `direction` |
| Grid | required | `columns` (1–4) |
| Card | optional | `title?`, `subtitle?` |
| Heading | none | `text`, `level` (1–4) |
| Text | none | `text`, `tone?` (default, muted) |
| Metric | none | `label`, `value`, `trend?`, `caption?` |
| List | none | `items` (strings, ≤ 20), `ordered?` |
| Table | none | `columns` (≤ 8), `rows` (≤ 50) of display strings |
| Callout | none | `tone`, `title`, `body` |
| Badge | none | `text`, `tone` |
| Link | none | `label`, `href` (URL guard) |
| Chart | none | `kind` (bar, line), `series` (≤ 4), `points` (≤ 24) |

The reference app's seven map onto these: Prose → Text, BarList → Chart (bar),
SourceLink → Link. The base theme's Chart is plain SVG (no chart library); a
connector may map it onto one, lazily.

---

## Open risks carried into the plan

1. The own reconciler (R2) — spike first; Lit is the fallback.
2. One root per framework-rendered node (R5) — measure; batch if needed.
3. Class-based libraries in `shadow` mode re-parse their stylesheet per instance
   unless adopted once and shared (R3) — test with Bootstrap.
4. Every size in this document was an estimate until phase 1. R1 and R7 are now
   measured; R2's reconciler and Lit figures remain estimates until phase 4.
