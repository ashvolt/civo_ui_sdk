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

- [ ] **T-230** Property test: for every prefix of three realistic streams, reconciled DOM
  equals a fresh render of that prefix.
- [ ] **T-231** Tests: identity skip — an untouched subtree's DOM nodes are the same
  objects after a frame.
- [ ] **T-232** Reconciler (keyed children, identity skip).
- [ ] **T-233** Tests: loader called once per type per page; triggered on exact type
  match only; partial type triggers nothing; failed load renders fallback, reported once,
  retried on next document only; `preload` loads eagerly.
- [ ] **T-234** Catalog and lazy loader.
- [ ] **T-235** Tests: validator never loaded for same-origin `server`; always loaded for
  others; connector never receives an invalid node.
- [ ] **T-236** Validation tiers in render core.
- [ ] **T-237** React renderer moves onto render core; its public API unchanged.
- [ ] **T-238** Test: a page with no renderer loads zero component chunks.

## Phase 4 — Element and generic connectors

- [ ] **T-240** Spike: own reconciler driving the DOM backend inside a custom element; pass
  T-230 there, or switch to Lit and record why.
- [ ] **T-241** Tests: element attributes, `source` property, `submit`, `stop`, events,
  refusal table from the contract.
- [ ] **T-242** `packages/element` with `shadow` and `light` modes.
- [ ] **T-243** Connector conformance suite: every component renders; text stays text;
  unknown type renders nothing; URL guard holds; fallback reported.
- [ ] **T-244** `defineConnector` for `class` and `element` kinds; `requires` check.
- [ ] **T-245** [P] Bootstrap 5 connector; passes T-243 in `light` and in `shadow` with
  adopted stylesheet.
- [ ] **T-246** [P] Shoelace connector; passes T-243.
- [ ] **T-247** Test: two elements, two themes, one page — no style leak in `shadow` mode.
- [ ] **T-248** `examples/html-host`; Playwright under `script-src 'self'` (no
  `unsafe-eval`).

## Phase 5 — Framework connectors

- [ ] **T-250** Mount contract tests: `mount`, `update`, `unmount`; children rendered by the
  core into the child host; `shadow` mode refused.
- [ ] **T-251** [P] `connect-react` + MUI sample; passes T-243.
- [ ] **T-252** [P] `connect-angular` + Angular Material sample; passes T-243.
- [ ] **T-253** [P] `connect-vue` + Vue library sample; passes T-243.
- [ ] **T-254** Measure: one root per node versus batched roots at 20, 100 and 300 nodes;
  batch where needed.
- [ ] **T-255** [P] `examples/angular-host`, `examples/vue-host`; Playwright each.
- [ ] **T-256** Same document rendered in all four hosts, compared structurally.

## Phase 6 — Documentation and CI

- [ ] **T-260** CI: no `dependencies` in protocol, render, element, theme-base; only peers in
  connectors; egress grep extended to new packages.
- [ ] **T-261** [P] `docs/security-model.md`: browser validation tiers, `light` mode trade-off.
- [ ] **T-262** [P] ADRs: own reconciler; shadow vs light; same-origin trust; mount contract.
- [ ] **T-263** [P] README, API reference, per-package READMEs, troubleshooting.
- [ ] **T-264** Fill plan.md Verification with measured results.

---

## Dependency order

```
0 ─► 1 ─► 2 ─► 3 ─► 4 ─► 5
          │         └─► 6 (docs per phase, CI with 4)
          └─ T-217 size report runs from phase 1 onward
```

## Outstanding

Phases 0, 1 and 2 are done. Everything from T-230 is outstanding.
