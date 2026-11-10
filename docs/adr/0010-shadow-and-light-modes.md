# ADR-0010 — Two element modes: isolated `shadow` by default, `light` for global stylesheets

**Status**: Accepted · **Date**: 2026-11-10 · **Principle**: IV, V
**Feature**: [003-pluggable-generative-ui](../../specs/003-pluggable-generative-ui/spec.md) · research R3

## Context

The spec asked for the element's styles to be isolated from the host page and
from other instances (FR-222). Shadow DOM does that, in both directions.

Theme libraries do not all live where a shadow root can see them:

| Library kind | Where its styles live | Inside a shadow root? |
|---|---|---|
| Base theme | ours | yes |
| Web-Component libraries (Shoelace, Material Web) | each component's own shadow root, themed by custom properties | yes, by design |
| Class-based (Bootstrap, Bulma, Tailwind) | one global stylesheet | only if that stylesheet is loaded inside |
| Framework libraries (MUI, Angular Material, Element Plus) | global CSS plus styles injected into `document.head` at runtime | no |

## Decision

`<gen-ui>` has two modes, fixed once it is on the page:

- **`shadow`** (default): renders into an open shadow root. The base theme's
  sheet is constructed once per page and adopted by every instance. Its tokens
  are scoped to `:host`, so the page restyles an element with ordinary CSS
  (`gen-ui { --gen-color-primary: … }`) and switches a variant with an
  attribute, both without re-rendering. A class connector may declare
  stylesheets. The element fetches each URL once per page and adopts it, with
  `:root` read as `:host`, so the library's custom properties apply.
- **`light`**: renders into the element's own children. Global stylesheets
  reach it. The base theme is still scoped under `.gen-theme` and to the
  element's name, so it styles nothing else on the page.

A connector declares the mode it needs. A framework connector in `shadow` mode,
or a class connector with no stylesheet to adopt, is refused with
`config_invalid`. It is never left to render unstyled.

A connector with its own colour switch (Bootstrap's `data-bs-theme`, Shoelace's
`sl-theme-dark`) declares per-variant attributes or classes for the surface, so
it follows the element's `variant` too.

## Alternatives considered

**Shadow only.** Rejected: it would exclude every framework component library,
contradicting a clarification answer, or force each to be re-skinned.

**Copy head-injected styles into each shadow root**, by watching
`document.head`. Rejected: it depends on each framework's private injection
order and breaks silently on upgrade.

**Light only, scoped by a class.** Rejected: the base theme and Web-Component
libraries would lose isolation they get for free.

**`<link>` per instance for class libraries.** Simpler. Rejected for the
default: every instance would parse the library again. It remains the fallback
on engines without constructable stylesheets.

## Consequences

**Good**

- Isolation is the default and is tested in Chromium in both directions: four
  elements with three looks on one page leak nothing into each other or the
  page.
- One page can mix modes. The Bootstrap example runs in both.
- No inline `<style>`, so `style-src 'self'` holds.

**Bad**

- **`light` mode gives up style isolation.** The page's CSS can restyle or hide
  generated elements. Integrity controls (validation, the tag and attribute
  allowlists, the URL guard) do not depend on the mode; appearance does. This is
  recorded in the security model's "not defended" list.
- **Rewriting `:root` to `:host` is a heuristic.** It suits the libraries
  tested (Bootstrap). A library whose stylesheet relies on `html` or `body`
  selectors would need its own handling.
- **The mode cannot change after insertion.** Moving rendered content between a
  shadow root and the light DOM would need a full re-render and a listener
  rewire. A change is refused rather than half-applied.
- **Third-party palettes are not ours.** Shoelace's badges and Element Plus's
  defaults fall below WCAG AA contrast. The examples fix the latter in host CSS;
  the former is excluded from one axe rule, and the exclusion is documented.

## Verification

- `examples/html-host/e2e/html-host.spec.ts`: no style crosses a shadow boundary
  in either direction; Bootstrap's adopted sheet styles its element only; a
  variant switch restyles without re-rendering; axe in light and dark.
- `packages/element/test/connectors.test.ts`: refusals for a light-only
  connector in shadow mode and for a missing library; the stylesheet is
  fetched once and shared; variant attributes and classes follow `variant`.
