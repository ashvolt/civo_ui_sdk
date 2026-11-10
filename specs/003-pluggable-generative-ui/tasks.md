# Tasks: Pluggable Generative UI

**Feature**: 003-pluggable-generative-ui
**Input**: [plan.md](./plan.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

`[P]` marks tasks with no dependency on each other. Per Principle VII, each test
task precedes the implementation it covers and must fail before it exists.
Numbered from T-201.

**Status legend**: `[x]` done · `[ ]` outstanding

---

## Phase 0 — Governance (done in this change)

- [x] **T-201** `spec.md`: twelve clarifications, no markers.
- [x] **T-202** Constitution v1.2.0: Principles IV and V clauses; Sync Impact Report.
- [x] **T-203** `research.md` (R1–R11), `data-model.md`, `contracts/element-and-connectors.md`,
  `quickstart.md`, this plan, with Constitution Check before and after design.
- [x] **T-204** Spec revisions from research: FR-207 (same-origin), FR-222 and scenario 15
  (shadow / light modes).

## Phase 1 — Protocol and inputs

- [x] **T-210** Tests: `protocol` exports equal `core`'s current protocol exports; `core`
  re-exports them; feature 001/002 suites unchanged.
- [x] **T-211** Extract `packages/protocol`: events, accumulator, JSON Patch, SSE decoder,
  `readUIStream`. Zero `dependencies`.
- [x] **T-212** [P] Tests: socket source — one event per message; `[DONE]`, `complete` and
  `error` end the document; renderer never closes the socket; close mid-document reports
  incomplete.
- [x] **T-213** [P] Tests: stream source and document source.
- [x] **T-214** Sources in `protocol`; `useGenerativeObject` accepts `source`.
- [x] **T-215** Tests (refusals): `validate: "server"` rejected for document, stream, socket
  and cross-origin URL; accepted for same-origin URL.
- [x] **T-216** Browser validation for foreign sources in the React path.
- [x] **T-217** [P] Size report CI job (esbuild metafile, gzip, previous-build comparison).
- [x] **T-218** Measure and replace research R1/R7 estimates with real numbers.

### Phase 1 notes

- **Core bundles protocol rather than depending on it.** Constitution V gives
  core no runtime dependency, so `protocol` is a devDependency of core,
  compiled in by tsup (`noExternal`, types resolved). Core's old module paths
  (`errors.ts`, `protocol.ts`, `stream/sse.ts`, `stream/json-patch.ts`) remain
  as re-export files, so every existing import, and every 001/002 test, is
  untouched. CI checks core's build never imports `relax-ui-protocol`.
- **`RelaxUIError` is recognised across copies.** Bundling means an application
  can hold two copies of the class (core's, and the one `relax-ui-react`
  imports). A registered-symbol brand and `Symbol.hasInstance` keep
  `instanceof` and `isRelaxUIError` true for both; verified against the built
  packages.
- **One deliberate behaviour change.** `useGenerativeObject({ api })` with a
  *cross-origin* `api` and no `schema` is now refused with `config_invalid`.
  NFR-206 asks for unchanged behaviour, but Constitution IV v1.2.0 requires full
  browser validation for anything but a same-origin route, and the constitution
  takes precedence. A same-origin `api`, the case in every example and test,
  behaves exactly as before.
- **Ending rules.** A `stream` or `socket` that ends without `complete` or
  `error` is `truncated`. A `url` is read exactly as before (stream close ends
  it), to keep NFR-206. A `document` has no generation, so no metadata and no
  `onComplete`.
- **Size report** runs as its own CI job, `continue-on-error`, comparing with
  the last `main` report through the Actions cache.

## Phase 2 — Contract and base theme

- [x] **T-220** Tests: twelve schemas — bounds (List ≤ 20, Table ≤ 8×50, Chart ≤ 4×24), no
  action props, Link URL guard, `extend()` may add or override, may not remove.
- [x] **T-221** `packages/contract`.
- [x] **T-222** Tests: server JSON Schema derived from the contract equals what the
  browser validates against.
- [x] **T-223** Tests: tokens only (no literal colours in component CSS); variant switch
  restyles without re-render; axe contrast in light, dark, compact.
- [x] **T-224** `packages/theme-base`: tokens, variants, twelve implementations, SVG chart.
- [x] **T-225** React renderer on the contract; next-app moved from its seven components
  to the twelve; theme switcher.

### Phase 2 notes

- **One schema builder, two packages.** `buildUISchemas` moved from core's
  `createUIRegistry` into `relax-ui-contract`; core now calls it (compiled in,
  as with protocol). `UINode`, `measureTree` and the URL guard moved to
  `relax-ui-protocol`, which every renderer needs. Old core paths re-export.
- **Templates, not per-framework implementations.** The base theme's twelve are
  functions from props to markup *data* (`VNode`). React renders them through
  `fromTemplates`; the phase 4 DOM backend will render the same templates. One
  implementation, so markup cannot drift between hosts.
- **Props as built** extend R11 slightly: Chart has `title`, `unit` and
  `labels` (series values align to labels); Table has an optional `caption`;
  Callout and Badge gain a `danger` tone; Stack has `direction`. Unknown props
  are stripped, not refused, so a model adding a harmless extra prop does not
  fail a generation; they never reach a component either way.
- **Roles.** Card is `region` (named by its title), Metric `group`, Badge and
  Callout `note` (not `status`: a live region would announce on every frame
  while streaming), Chart `img` with the data in its accessible name.
- **Contrast** is checked twice: a unit test computes WCAG ratios for every
  colour pair in every variant, and axe audits the rendered dashboard in the
  browser in light, dark and compact.
- **Density** is a scale on `--gen-space-unit` and the type scale, not the
  `--gen-density` integer the data model first sketched.
- **Found on the way: protocol-relative URLs.** The URL guard from feature 001
  passed `//evil.example/x` (and `/\evil.example`) as relative paths. It now
  refuses them; a test is added to core's guard suite.
- **Bundle cost.** `baseComponents` is marked pure, so an app that does not
  import it does not ship the theme: hook-only stays 4.8 KB gzip; hook,
  renderer and base theme together are 9.6 KB.

## Phase 3 — Render core and lazy loading

- [x] **T-230** Property test: for every prefix of three realistic streams, reconciled DOM
  equals a fresh render of that prefix.
- [x] **T-231** Tests: identity skip — an untouched subtree's DOM nodes are the same
  objects after a frame.
- [x] **T-232** Reconciler (keyed children, identity skip).
- [x] **T-233** Tests: loader called once per type per page; triggered on exact type
  match only; partial type triggers nothing; failed load renders fallback, reported once,
  retried on next document only; `preload` loads eagerly.
- [x] **T-234** Catalog and lazy loader.
- [x] **T-235** Tests: validator never loaded for same-origin `server`; always loaded for
  others; connector never receives an invalid node.
- [x] **T-236** Validation tiers in render core.
- [x] **T-237** React renderer moves onto render core; its public API unchanged.
- [x] **T-238** Test: a page with no renderer loads zero component chunks.

### Phase 3 notes

- **`relax-ui-render` has no dependencies.** It compiles in the protocol's URL
  guard and error type, as core does; CI checks its build imports neither.
- **One resolver, two renderers.** The resolver (contract-only, validation by
  tier, catalog, reports) is framework-neutral; the DOM backend and React both
  call it, so they cannot disagree about what a document shows. React's public
  API is unchanged; it keeps eager components and full validation, and gains
  `React.memo` on each node, so unchanged subtrees skip on identity as in the
  DOM backend.
- **Not done: lazy loading for React.** The resolver supports it, but React
  hosts still pass eager components. A lazy React renderer is a small follow-up;
  the DOM path, which phase 4's element uses, is lazy now.
- **Reconciler, verified.** Every prefix of three realistic streams (two
  characters per frame, both tiers) renders identically to a fresh render, by
  a canonical form that sorts attributes (an `href` refused mid-stream and set
  later is appended last; order carries no meaning). Three deliberate mutations
  were each caught. This de-risks T-240: the own reconciler holds, so Lit is not
  needed.
- **Report timing.** Unknown types and invalid props are reported only when a
  document completes: mid-stream they are usually a name or a value still
  arriving. Load failures and depth are reported at once.
- **Base theme split** into five lazily loaded groups. Two bundle leaks were
  found and fixed by the T-238 bundle test and the size report: `describeChart`
  re-exported from the chart module kept the whole Chart chunk static, and the
  CSS strings, built with a helper call, could not be dropped until annotated
  pure. A page with the renderer and lazy theme, rendering nothing, is 4.1 KB
  gzip with no component code; each group costs 0.4–1.3 KB on first use.
- **Templates tolerate partial props**, for the `server` tier, where a
  same-origin stream's nodes reach templates unvalidated mid-stream.

## Phase 4 — Element and generic connectors

- [x] **T-240** Spike: own reconciler driving the DOM backend inside a custom element; pass
  T-230 there, or switch to Lit and record why.
- [x] **T-241** Tests: element attributes, `source` property, `submit`, `stop`, events,
  refusal table from the contract.
- [x] **T-242** `packages/element` with `shadow` and `light` modes.
- [x] **T-243** Connector conformance suite: every component renders; text stays text;
  unknown type renders nothing; URL guard holds; fallback reported.
- [x] **T-244** `defineConnector` for `class` and `element` kinds; `requires` check.
- [x] **T-245** [P] Bootstrap 5 connector; passes T-243 in `light` and in `shadow` with
  adopted stylesheet.
- [x] **T-246** [P] Shoelace connector; passes T-243.
- [x] **T-247** Test: two elements, two themes, one page — no style leak in `shadow` mode.
- [x] **T-248** `examples/html-host`; Playwright under `script-src 'self'` (no
  `unsafe-eval`).

### Phase 4 notes

- **T-240 settled for the own reconciler.** Inside `<gen-ui>` the DOM backend
  passes the same check as T-230: a streamed document, delivered over a
  WebSocket and over SSE with chunk boundaries at arbitrary bytes, ends
  identical to a fresh render, and unchanged nodes keep their DOM. Lit is not
  used.
- **One connector interface, three implementation forms.** `class` restyles
  the base theme's markup by mapping its BEM classes (`gen-card__title`,
  `gen-tone--warning`, `gen-heading--2`); `element` swaps the root for a library
  element, sets attributes from props and slots named parts; `template` is
  markup as data. Both declarative forms start from the base theme's template,
  so text handling and the contract's ARIA role are never re-implemented per
  library, and a connector cannot write markup at all (FR-238).
- **Connector variants.** Found by axe in dark mode: Bootstrap and Shoelace have
  their own dark switches, which the base theme's tokens do not reach. A
  connector declares `variants` (`data-` attributes or classes for the surface
  per variant), so a library follows the element's `variant` attribute, still
  without re-rendering. Shoelace's dark sheet targets `:host` too; the example
  serves a copy without it.
- **Adopted global stylesheets.** A global stylesheet declares its custom
  properties on `:root`, which matches nothing in a shadow root; the element
  rewrites `:root` to `:host` when adopting one. Each URL is fetched once per
  page and the parsed sheet shared by every instance.
- **The element's only peers** are `relax-ui-contract` and Zod, both optional:
  the default full-tier validator is a dynamic import of the contract, so a page
  using `validate="server"` installs and ships neither. CI asserts this.
- **Shoelace's badge colours** (white on its 600 shades) fall just short of
  4.5:1. That is the library's palette inside its own shadow root; the axe check
  excludes only those badges, and still checks contrast for everything else the
  connector renders, which is what caught Shoelace surfaces staying light in
  dark mode.
- **Sizes (gzip):** `<gen-ui>` registered on a page, nothing rendered, 13.1 KB
  (protocol, render core, base theme CSS and the element), no component code
  and no validator, checked by a bundle test and in Chromium. The connector
  code adds about 2 KB to `relax-ui-render`'s own size, and nothing to a page
  that does not use it (the DOM scenario stays at 4.1 KB).
- **Mutation checks:** keeping unmapped `gen-` classes (3 failures), skipping
  `requires` (4), dropping fallback reports (6), and serving Shoelace without
  its dark sheet (caught by the e2e contrast check).

## Phase 5 — Framework connectors

- [x] **T-250** Mount contract tests: `mount`, `update`, `unmount`; children rendered by the
  core into the child host; `shadow` mode refused.
- [x] **T-251** [P] `connect-react` + MUI sample; passes T-243.
- [x] **T-252** [P] `connect-angular` + Angular Material sample; passes T-243.
- [x] **T-253** [P] `connect-vue` + Vue library sample; passes T-243.
- [x] **T-254** Measure: one root per node versus batched roots at 20, 100 and 300 nodes;
  batch where needed.
- [x] **T-255** [P] `examples/angular-host`, `examples/vue-host`; Playwright each.
- [x] **T-256** Same document rendered in all four hosts, compared structurally.

### Phase 5 notes

- **The mount contract** lives in the render core: a `mount` implementation
  gets a host element and a child host from the renderer; `update` runs only
  when a node's props changed (a test walks a complete document again and
  counts zero updates); `unmount` runs when a node, its subtree or the renderer
  goes. A component that throws while mounting is reported once and the rest
  of the document renders. `href` and `src` pass the URL guard again before
  they reach a component, since its attributes are out of the renderer's reach.
- **Children placement per framework:** React's `children` (an element the
  child host is moved into), Vue's default slot (likewise), Angular's
  `<ng-content>` (the child host is projected with `projectableNodes`, no
  wrapper at all).
- **T-254 measured, no batching.** In Chromium, one React root per node
  completed 300 nodes in 14 ms against 70 ms for one shared root with portals,
  and its worst streamed frame was 6 ms. Unchanged nodes never reach React, so
  sharing a root buys nothing (research R5).
- **Three samples pass the one conformance suite**: MUI (11 of 12 types),
  Element Plus (6) and Angular Material (5), each also checked for drawing the
  library's own components around the renderer's children. Angular runs just
  in time in the unit tests and ahead of time in the app.
- **Hosts under a strict policy.** The Vue app uses the runtime-only build and
  render functions; the Angular app is compiled ahead of time and ships no
  compiler (asserted). Scripts are `'self'` everywhere; Angular's runtime
  component styles take a per-page nonce. Axe passes on every element.
- **Found by the hosts:** Vue sets a custom element's *property* when one
  exists, so `source="/api/ui"` arrived as a string; the property now takes a
  URL string as the attribute does. Element Plus's default palette and
  Material's Roboto-only prebuilt typography needed host CSS (a darker palette,
  system font fallbacks); both are library defaults, fixed where a host would.
- **T-256:** the same document, from the same route, serialises identically in
  the plain HTML page, the Vue app, the Angular app (all `<gen-ui>`) and a React
  page (`relax-ui-react`). A deliberate one-word difference fails the test.
- **Angular CLI 22 needs Node ≥ 22.22.3** (CI's Node 22 qualifies); locally the
  Angular example was built with Node 24.
- **Sizes (gzip):** each connector about 1.9 KB including `defineConnector`;
  `<gen-ui>` with nothing rendered is 13.6 KB (mount support added 0.5 KB).

## Phase 6 — Documentation and CI

- [x] **T-260** CI: no `dependencies` in protocol, render, element, theme-base; only peers in
  connectors; egress grep extended to new packages.
- [x] **T-261** [P] `docs/security-model.md`: browser validation tiers, `light` mode trade-off.
- [x] **T-262** [P] ADRs: own reconciler; shadow vs light; same-origin trust; mount contract.
- [x] **T-263** [P] README, API reference, per-package READMEs, troubleshooting.
- [x] **T-264** Fill plan.md Verification with measured results.

### Phase 6 notes

- **T-260** was built up phase by phase. CI asserts:
  - protocol, theme-base and render declare no dependencies or peers;
  - the element declares none, with the contract and Zod as optional peers;
  - each connector's only peer is its framework;
  - no build imports a workspace package it must compile in;
  - no `node:` import and no raw-HTML sink in any browser package;
  - the egress grep covers every browser package.
- **T-261** `docs/security-model.md` 1.1 adds §4.7, the browser:
  - trust tiers;
  - output safety, whatever the renderer or connector;
  - what connectors cannot do;
  - the `light` mode trade-off;
  - CSP.
  Three items were added to "not defended": page styles in light mode, a
  connector library's own code, a library's palette.
- **T-262** ADR-0009 (own reconciler), ADR-0010 (shadow and light),
  ADR-0011 (same-origin trust), ADR-0012 (mount contract), each with its
  rejected alternatives and its unhappy consequences.
- **T-263** API reference gains the browser packages and the hook's `source`
  option; troubleshooting gains a browser section, symptoms first; the README
  gains "Any host, any source, any theme library"; every new package and
  example has a README.
- **T-264** plan.md's Verification table holds the measured results, and its
  known limitations are updated from expected to measured.

---

## Dependency order

```
0 ─► 1 ─► 2 ─► 3 ─► 4 ─► 5
          │         └─► 6 (docs per phase, CI with 4)
          └─ T-217 size report runs from phase 1 onward
```

## Outstanding

All phases, 0 to 6, are done.
