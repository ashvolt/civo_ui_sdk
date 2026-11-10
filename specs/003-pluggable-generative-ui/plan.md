# Implementation Plan: Pluggable Generative UI

**Branch**: `003-pluggable-generative-ui` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)
**Constitution**: [v1.2.0](../../.specify/memory/constitution.md) — amended for this feature

---

## Summary

Make the browser half of the SDK as portable as the server half: a dependency-free
protocol package, a standard twelve-component contract, a framework-neutral
render core with lazy loading and tiered validation, a `<gen-ui>` Web Component
that any host can place, a token-based base theme, and one connector interface
through which any theme library — class-based, Web-Component-based, or framework
components in React, Angular and Vue — styles the result.

The insight the design turns on: *streaming already gives the renderer the two
facts it needs to be cheap.* `applyPatch` shares structure, so a subtree no frame
touched is the same object next time — the reconciler's diff collapses to an
identity check, small enough to write without a framework. And the model writes a
node's `type` before its props, so the component's code can be fetched while the
props it will render are still arriving — lazy loading with almost no visible
cost. The hard part is not rendering; it is style isolation against global theme
libraries, which research R3 shows cannot be fully had, and the plan says so.

---

## Technical Context

| | |
|---|---|
| **Language** | TypeScript 5.7, `strict`, `noUncheckedIndexedAccess` |
| **Browser targets** | evergreen: Custom Elements v1, Shadow DOM, constructable stylesheets, dynamic `import()` |
| **New runtime dependencies** | none in protocol, render, element or base theme; framework connectors take React / Angular / Vue as peers |
| **Build** | tsup per package; esbuild metafile for size reports |
| **Test** | Vitest + happy-dom for render core and element; Playwright for hosts; property tests for the reconciler |
| **Hosts to verify** | React (existing app), Angular, Vue, plain HTML — one example app each |
| **Wire protocol** | version 1, unchanged |

---

## Constitution Check — pre-design

Against v1.1.0, which was in force when the spec was written.

| Principle | Assessment | Verdict |
|---|---|---|
| I. Sovereignty | Browser-only feature; no new egress. A same-origin URL is the only network source the renderer opens itself; sockets and streams are the host's | PASS |
| II. Schema is the contract | One contract drives server schema and browser validation. Rejected a second, lighter browser validator for exactly this reason (R7) | PASS |
| III. Capability negotiated | Not touched | PASS |
| IV. Model output untrusted | "Validation MUST happen on the server" cannot be satisfied for a static document or a WebSocket, which never pass through the SDK's server | **FAIL as written** |
| V. The edge is a target | Core untouched. But nothing said what a *browser* package or a *connector* package may depend on | **UNDERSPECIFIED** |
| VI. Spec precedes implementation | spec → clarify (12 answers) → this plan → tasks; no code yet | PASS |
| VII. Every behaviour has a test | Plan requires refusal tests for every configuration error and property tests for the reconciler | PASS |

**Resolution**: constitution amended to **v1.2.0** (MINOR) in this change.
Principle IV gains three clauses — foreign documents are validated in full in the
browser; skipping is allowed only for a same-origin SDK route on request; a
connector styles validated nodes and never decides validity. Principle V gains
three — protocol package has no dependencies, connectors may take only their
library as a peer, a page that renders nothing loads no component. Every new
clause adds an obligation; none relaxes an existing one.

---

## Spec revisions from research

Spec Kit allows planning to feed back into the specification when research
contradicts it. Two did:

| Spec item | Was | Now | Why |
|---|---|---|---|
| FR-207 | validation may be skipped "only for the SDK's own route" | only for a **same-origin URL** source, on request | A browser cannot prove a stream came from the SDK; origin is the only meaningful boundary (R4) |
| FR-222, scenario 15 | styles MUST be isolated | isolation in `shadow` mode, the default; `light` mode permitted, and required for framework connectors | Global theme libraries and Shadow DOM cannot both be fully satisfied (R3) |

Both are recorded in spec.md under *Planning revisions*.

---

## Project Structure

```
packages/
  protocol/        new — events, accumulator, JSON Patch, readers (SSE, stream, socket, document)
  contract/        new — the twelve schemas, extend(), budget; Zod peer
  render/          new — render core: catalog, lazy loader, validation tiers, keyed reconciler,
                         defineConnector (class + element kinds)
  element/         new — <gen-ui>: attributes, events, shadow/light modes, DOM backend
  theme-base/      new — tokens CSS, light/dark/compact, twelve DOM implementations, SVG chart
  connect-react/   new — reactConnector (mount via createRoot)
  connect-angular/ new — angularConnector (createComponent + hostElement)
  connect-vue/     new — vueConnector (createApp / render)
  core/            re-exports protocol; otherwise unchanged
  react/           uses render core + contract; public API unchanged
examples/
  next-app/        existing; gains a theme switcher
  angular-host/    new — Angular Material via connector
  vue-host/        new — a Vue library via connector
  html-host/       new — Bootstrap and Shoelace via connectors, no framework
```

**Structure decision**: one package per *reason to change*. The protocol changes
with the wire format, the contract with the vocabulary, the render core with
rendering rules, each connector with its framework. A host pays for exactly the
ones it imports, and Principle V's dependency rule can be checked per package by
CI rather than argued per file.

**Rejected shape**: *one `relax-ui-browser` package with optional sub-paths.*
Fewer manifests, and every host would install React, Angular and Vue peer
declarations it does not use.

---

## Design decisions

### D1 — Own reconciler on structural sharing (R2)
Identity check per node plus keyed children. Spike first in phase 4; Lit is the
fallback if the spike fails its property tests.

### D2 — Two element modes: `shadow` (default) and `light` (R3)
Isolation where the library allows it; container scoping where it does not.

### D3 — Same-origin is the trust boundary for skipping validation (R4)

### D4 — Framework components via a mount contract (R5)
The render core owns the tree; connectors mount framework components into host
elements it creates.

### D5 — Lazy by type, triggered on the first exact type match (R6)

### D6 — The validator is lazy too, and never loaded for a trusted route (R7)

### D7 — Themes are CSS custom properties, Material-3-aligned names (R8)

### D8 — Size is reported from esbuild metafiles; no new tooling (R10)

---

## Phase plan

Five releases, each usable on its own. Order is by dependency, then by value.

| Phase | Delivers | Usable for | Depends on |
|---|---|---|---|
| **1 — Protocol & inputs** | `protocol` package; document / stream / socket sources for the existing React hook; browser validation for foreign sources; size report job | React hosts with any data source; first real size numbers | — |
| **2 — Contract & base theme** | `contract` (twelve); `theme-base` tokens + variants; React renderer on the contract; next-app theme switcher | React hosts with themes | 1 |
| **3 — Render core & lazy loading** | `render`: catalog, lazy loader, validation tiers, reconciler; React moves onto it | smaller React bundles | 2 |
| **4 — Element & generic connectors** | `<gen-ui>`; shadow/light; class and element connectors; Bootstrap + Shoelace examples; html-host | **any framework, any MFE**, class- and WC-based libraries | 3 |
| **5 — Framework connectors** | `connect-react`, `connect-angular`, `connect-vue`; angular-host, vue-host | Angular Material, MUI, Vuetify-style libraries | 4 |

**Effort shape** (relative, not dated): phase 5 is the largest — three
frameworks, three example builds, three browser test setups. Phases 1 and 2 are
the smallest and deliver the most immediately.

---

## Constitution Check — post-design

Against v1.2.0. Evidence is *planned*; it becomes evidence when the tasks that
produce it are done.

| Principle | Planned evidence | Verdict |
|---|---|---|
| I | No package opens a connection except to a same-origin URL the host gave it; CI egress grep extended to new packages | PASS |
| II | One `contract` package feeds server JSON Schema and browser validation; no second validator | PASS |
| III | Unchanged | PASS |
| IV | Refusal tests: `validate="server"` with each non-same-origin source; connector receiving an invalid node; `dom` implementation helper refusing markup; URL guard under every connector kind | PASS |
| V | CI asserts `protocol`, `render`, `element`, `theme-base` have no `dependencies`; connector packages have only peers; a test page with no `<gen-ui>` loads zero component chunks | PASS |
| VI | This chain, gated both ends | PASS |
| VII | Reconciler property test over every prefix of realistic streams; connector conformance suite run against every connector | PASS |

### Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Spec FR-222 weakened: isolation is not guaranteed in `light` mode | Framework theme libraries inject styles into `document.head`, which no shadow root sees (R3) | Copying head styles into each shadow root relies on private framework behaviour and breaks on upgrade; refusing framework connectors contradicts a clarification answer |
| A hand-written reconciler | Keeps render core dependency-free and able to drive mount-based connectors | Lit adds a layer between the core and framework mounts without removing one; kept as the fallback |

---

## Verification

Measured at the end of phase 5. Unit and integration: 736 tests (`pnpm verify`);
in the browser: 42 Playwright tests in five suites; all run in CI.

| Gate | How | Result |
|---|---|---|
| Existing suites | features 001 and 002 tests run unmodified (NFR-206) | Pass. The 24 Next.js browser tests are unchanged and pass |
| Reconciler | property test: the DOM after every prefix of three realistic streams (2 characters per frame, both tiers) equals a fresh render of that prefix; unchanged nodes keep their DOM | Pass, in the DOM backend and inside `<gen-ui>` (WebSocket; SSE split at arbitrary bytes). Deliberate bugs in text patching, key matching and the waiting check were each caught |
| Mount contract | mount, update, unmount counts; subtree disposal; a final pass updates nothing | Pass. Deliberate bugs in disposal and update-on-change were each caught |
| Connector conformance | one suite: every component renders with its contract role; text stays text; unknown type renders nothing; URL guard holds in both tiers; fallbacks reported | Pass for 8 configurations: base theme (shadow, light), Bootstrap 5 (light; shadow with adopted sheet), Shoelace, Bootstrap + Shoelace layered, MUI, Element Plus, Angular Material |
| Hosts | Playwright: the same document in four hosts, compared structurally | Pass. Plain HTML, Vue and Angular through `<gen-ui>`, and React through `relax-ui-react`, serialise identically. The React host is a page of `html-host`, not `next-app`, whose route is model-driven. A one-word difference fails the test |
| Lazy loading | a page with the element and no document loads no component chunk and no validator | Pass: bundle tests (esbuild) and Chromium. Component code is requested on the exact type name and loaded once per page. A same-origin route never downloads Zod; a page with foreign sources downloads it once |
| Trust | each refusal in the contract's Refusals table has a test | Pass: `validate="server"` with a document, stream, socket or another origin; a missing library; a light-only connector in shadow mode; an unknown type. Nothing is fetched or rendered after a refusal |
| CSP | every example served with `script-src 'self'`, no `unsafe-eval`, no `unsafe-inline` | Pass, with no violation in html-host, vue-host and angular-host. Styles are `'self'`, plus a per-page nonce for Angular's runtime component styles. The Angular app ships no compiler (asserted) |
| Style isolation | four elements, three looks, one page | Pass in Chromium, in both directions |
| Accessibility | axe in Playwright (NFR-205) | Pass: the base theme in light, dark and compact; Bootstrap; Element Plus (host palette); Angular Material. Shoelace passes all rules except contrast on its own badges (security model, §5) |
| Size | report on every CI run, compared with `main` | Present. Gzip: `<gen-ui>` with nothing rendered 13.6 KB; the render core 4.1 KB with the lazy base theme; each lazy component group 0.4–1.3 KB; each connector about 1.9 KB; the React hook alone 4.8 KB (unchanged) |
| Framework roots (T-254) | one root per node against one shared root, 20/100/300 nodes, Chromium | One root per node: 14 ms to complete 300 nodes against 70 ms for a shared root; worst streamed frame 6 ms. No batching (research R5) |

---

## Known limitations

1. `light` mode gives up style isolation; scoping relies on a container class.
2. Framework connectors create one framework root per node. Measured fine at 300
   nodes (T-254); documents far beyond the 500-node default budget were not
   measured.
3. Class-based libraries in `shadow` mode cost one stylesheet parse per page
   (shared via adopted stylesheets), not per instance — but a library that
   expects global scripts (Bootstrap's JS components) will not work there; the
   twelve need none.
4. Sizes are measured (research R1, R2, R7; the size report). The research
   tables' original estimates are kept beside the measurements.
5. Size is reported, not enforced (clarification).
6. Read-only components only; interaction is a later feature.
7. A connector's library palette is the library's: Shoelace's badges fall below
   WCAG AA contrast, and Element Plus's defaults needed host CSS.
8. Adopting a global stylesheet into a shadow root rewrites `:root` to `:host`;
   a library keyed to `html` or `body` selectors needs its own adaptation.
9. The Angular example's CLI needs Node 22.22.3 or later; the connector does
   not.
