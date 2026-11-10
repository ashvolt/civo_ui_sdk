# ADR-0012 — Framework components are mounted per node through one contract

**Status**: Accepted · **Date**: 2026-11-10 · **Principle**: IV, V
**Feature**: [003-pluggable-generative-ui](../../specs/003-pluggable-generative-ui/spec.md) · research R5

## Context

An Angular Material `mat-card`, an MUI `Card` and an Element Plus `ElCard` are
components of their own frameworks. The renderer is not any of those frameworks
(ADR-0009), yet a framework connector has to put such a component on the page
for a node, keep it updated while the document streams, nest the node's
children inside it, and remove it when the node goes. The renderer must still
own the tree, so that validation, the depth limit and lazy loading stay in one
place.

## Decision

A framework connector supplies a **mount implementation** per type:

```ts
mount(host: Element, props, childHost: Element): { update(props): void; unmount(): void }
```

The renderer:

- creates `host` (`<gen-mount>`) and `childHost` (`<gen-children>`), both
  `display: contents`;
- calls `mount` once per node with validated props, after `href` and `src` pass
  the URL guard again;
- calls `update` only when the node's props object changed. A final pass over a
  complete document updates nothing;
- calls `unmount` when the node leaves, when its subtree leaves, when its type
  changes, or when the renderer is destroyed;
- reconciles the node's children into `childHost`. The component only places
  that element; it never renders model children.

Each framework fills the contract with its own public API. One package per
framework, whose only peer is that framework:

| Package | Mount | Where children go |
|---|---|---|
| `relax-ui-connect-react` | `createRoot(host)` + `flushSync(render)` | `children`, an element the child host is moved into |
| `relax-ui-connect-vue` | `render(h(Component, props), host)` in the host app's context | the default slot |
| `relax-ui-connect-angular` | `createComponent(Type, { hostElement: host, projectableNodes: [[childHost]] })`, attached to the app | `<ng-content>`, by projection |

Framework connectors are always `light` mode (ADR-0010).

## Alternatives considered

**One shared root per renderer, with portals** (React, Vue). Measured in
Chromium and rejected. One root per node completed 300 nodes in 14 ms against
70 ms for a shared root. Its worst streamed frame was 6 ms. The renderer skips
unchanged nodes before the framework is called at all, so a shared root saves
nothing, and it re-renders every portal per mount.

**Let the framework render the whole document**, with the renderer only
validating. Rejected: every framework would re-implement keys, depth, lazy
loading and refusal reporting, and three implementations would drift. The
conformance suite exists to keep them identical.

**Framework components render their own children** from the node. Rejected: a
component would then see model data the resolver never validated for it, and a
library component could render a child type the contract does not have.

**Copy or wrap components as Web Components** (Angular Elements, Vue's
`defineCustomElement`). Rejected: each component becomes its own shadow root
and loses the library's global styles (ADR-0010), and each framework's wrapper
behaves differently.

## Consequences

**Good**

- One conformance suite passes for MUI, Element Plus and Angular Material,
  unchanged from the class and element connectors.
- Each connector package is about 1.9 KB gzip and brings no second copy of its
  framework.
- Angular components get the host app's injector, Vue components the host app's
  context, so plugins and providers work as in the rest of the app.
- The same document serialises identically in plain HTML, Vue, Angular and React
  hosts.

**Bad**

- **A framework component sets its own attributes**, outside the renderer's
  allowlists. Text stays text because the frameworks escape it, and the URL guard
  runs on props. But a component that writes `innerHTML` from a prop would defeat
  output safety, as an application component always could (security model §5).
- **One root per node has a cost per node.** It is measured as well within a
  frame at 300 nodes. Documents far beyond the default 500-node budget were not
  measured.
- **Synchronous rendering** (`flushSync`, `detectChanges`) is what makes child
  placement deterministic. A host that sets `source` from inside a React render
  or an Angular change detection pass may see framework warnings about nested
  synchronous rendering.
- **Angular's CLI 22 needs Node 22.22.3 or later** for the example's build. The
  connector itself only needs `@angular/core`.

## Verification

- `packages/render/test/mount.test.ts` (T-250):
  - mount, update and unmount counts;
  - children in the child host;
  - subtree disposal, and unmount on type change, on `render(undefined)` and on
    destroy;
  - a throwing mount reported once;
  - the URL guard on props;
  - streamed documents leaving no leaked mounts;
  - mutations to disposal and to update-on-change caught.
- `packages/connect-{react,vue,angular}/test`: the conformance suite against MUI,
  Element Plus and Angular Material, plus checks that each library draws its own
  components around the renderer's children.
- `examples/{vue,angular}-host/e2e`: the apps under a strict policy (T-255).
- `examples/cross-host/e2e/same-document.spec.ts`: one document, four hosts, one
  structure (T-256).
