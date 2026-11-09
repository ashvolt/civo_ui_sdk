# Phase 1 — Data Model

**Feature**: 003-pluggable-generative-ui
**Date**: 2026-11-09

The types that cross a boundary in the browser, and their invariants. Nothing
here changes the wire protocol (version 1) or any server-side type.

---

## Entity map

```
            Source ──────────► protocol (accumulate) ──► Document (UINode tree)
   static · url · stream · ws        │                         │
            │                        │ new type seen           │ validation tier
            │                        ▼                         ▼
            │                     Catalog ──load──►  Implementation   Contract
            │                        ▲                    ▲      (12 + extensions)
            │                        │                    │
            └── trust ──────►   RenderCore ──mount──► Connector ──► Theme library
                                     │                (class · element · framework)
                                     ▼
                              DOM backend / React
```

---

## 1. `Contract` (new)

The component vocabulary: the twelve standard components plus any the
application adds.

| Field | Notes |
|---|---|
| `components` | name → `{ props: schema, children: none \| optional \| required, role: string }` |
| `budget` | node and depth limits (feature 001's defaults) |

**Invariants**

- C1. Names match `^[A-Z][A-Za-z0-9]{0,31}$` and are unique.
- C2. An application addition may add a name or override a standard one's
  schema; it may not remove a standard name (a theme may rely on it).
- C3. The server derives JSON Schema from the contract and the browser validates
  against the same contract — one declaration (Principle II).
- C4. No component schema contains an action prop (function, event name, script
  URL). Link's `href` passes the URL guard.
- C5. `role` is an ARIA role or landmark a theme must give the component's root.

---

## 2. `Source` (new)

| Kind | Value | May skip browser validation? |
|---|---|---|
| `document` | a complete `{ root: UINode }` | **no** |
| `url` | http(s) URL returning the SSE protocol | **only if same-origin** and `validate: "server"` |
| `stream` | `ReadableStream<Uint8Array>` in SSE framing | **no** |
| `socket` | `WebSocket`, one event per message | **no** |

**Invariants**

- S1. `validate: "server"` with any source not in the "only if" row is a
  configuration error at construction, never a silent upgrade to full validation.
- S2. The renderer never closes a socket it was given; it stops listening.
- S3. Every streaming kind is folded by the same accumulator, with protocol 1's
  sequencing rules.

---

## 3. `Implementation` (new)

What renders one component type.

```ts
type Implementation =
  | { kind: "dom";     render(props, children: Node[], ctx): Element }
  | { kind: "element"; tag: string; props?: PropMapping; slots?: SlotMapping }
  | { kind: "class";   tag: string; classes: ClassMapping; slots?: SlotMapping }
  | { kind: "mount";   mount(host: Element, props, childHost: Element): Mounted };

interface Mounted { update(props): void; unmount(): void }
```

**Invariants**

- I1. An implementation receives only props that passed validation (or came from
  a same-origin trusted route).
- I2. Text props reach the DOM as text nodes or attribute values, never as
  markup. `dom` implementations are given a helper that enforces this; `class`
  and `element` implementations cannot express markup at all.
- I3. Children are rendered by the render core into the element the
  implementation designates (`childHost` or a slot); an implementation does not
  render model children itself.

---

## 4. `Connector` (new)

A named set of implementations for one theme library.

| Field | Notes |
|---|---|
| `name` | e.g. `bootstrap-5`, `material-web`, `angular-material` |
| `kind` | `class` · `element` · `framework` |
| `mode` | `shadow` or `light` the connector requires (R3) |
| `stylesheets` | for `class` connectors in `shadow` mode: URLs adopted once, shared across instances |
| `implementations` | type → `Implementation \| Loader<Implementation>` |
| `requires` | a check that the library is present (custom element defined, global class present) |

**Invariants**

- K1. A type the connector does not implement falls back to the base theme, and
  the fallback is reported once per type per document (FR-237).
- K2. A framework connector declares `mode: "light"`.
- K3. If `requires` fails, construction is a configuration error naming the
  library (spec, Edge Cases).
- K4. When two connectors are layered and both implement a type, the later one
  wins and the override is reported.

---

## 5. `Catalog` (new)

The resolved type → implementation table for one element instance: base theme,
then connectors in order, then application additions.

**Invariants**

- G1. Entries are loaders by default; `preload` turns chosen ones eager.
- G2. A loader is called at most once per type per page; its promise is shared.
- G3. A loader is called when a type equal to a contract name first appears in a
  document — never for a partial or unknown type.
- G4. A rejected loader marks the type failed for the current document only.

---

## 6. `Theme` (new)

Design tokens plus the base implementations.

| Token group | Examples |
|---|---|
| colour roles | `--gen-color-primary`, `-surface`, `-on-surface`, `-outline`, `-success`, `-warning`, `-info` |
| typography | `--gen-font-family`, `--gen-font-size-{1..5}` |
| shape | `--gen-radius-{s,m,l}` |
| spacing | `--gen-space-{1..6}` |
| density | `--gen-density` (0, −1, −2) |

**Invariants**

- T1. Base implementations read tokens only; no literal colours in component CSS.
- T2. Variants (`light`, `dark`, `compact`) are attribute selectors; switching one
  re-styles without re-rendering.
- T3. All three variants meet WCAG 2.2 AA contrast for every colour pair a
  component uses (NFR-205).

---

## 7. `RenderState` (new)

What the element reports to its host, matching the React hook (FR-223):
`status` (`idle` · `streaming` · `complete` · `error`), `strategy`, `provider`,
`error`, `metadata`, plus `fallbacks` (types rendered by the base theme instead
of the connector) and `loadFailures`.

Delivered as DOM events (`gen-ui:state`, `gen-ui:frame`, `gen-ui:complete`,
`gen-ui:error`), so any framework can listen without an adapter.

---

## 8. `SizeReport` (new, tooling only)

Per build: `{ name, kind: "package" | "chunk", gzipBytes, previousGzipBytes? }[]`,
written to the CI job summary. Never fails a build.

---

## Unchanged

`UINode`, every `UIStreamEvent`, `GenerationMetadata`, `UIStreamAccumulator`,
`applyPatch`. They move package (protocol) and are re-exported from `core`.
