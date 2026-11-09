# relax-ui-render

The framework-neutral render core for the relaxAI Generative UI SDK, with a DOM
backend. **No dependencies**; the URL guard is compiled in from
`relax-ui-protocol`.

## Use

```ts
import "relax-ui-theme-base/theme.css";
import { readSource, UIStreamAccumulator } from "relax-ui-protocol";
import { createCatalog, DomRenderer } from "relax-ui-render";
import { baseLoaders } from "relax-ui-theme-base";

const renderer = new DomRenderer(document.querySelector(".gen-theme")!, {
  catalog: createCatalog({ loaders: baseLoaders }), // code fetched on first use
  types: Object.keys(baseLoaders),
  validate: "full",
  // Zod and the contract load only when a node first needs checking.
  validator: () => import("./contract").then((m) => m.validator),
});

const doc = new UIStreamAccumulator();
for await (const event of readSource({ socket })) {
  doc.apply(event);
  renderer.render(doc.current()?.root, { complete: event.type === "complete" });
}
```

Phase 4 wraps this in a `<gen-ui>` Web Component, so a host can skip this wiring.

## What it decides, per node

The resolver asks the same questions in the same order for every renderer.
React uses it too:

1. Too deep, or not a contract type? Not rendered. Unknown types are reported
   only once the document is complete, because mid-stream a name may still be
   arriving.
2. An exact contract type: **start loading its code now**, before its props have
   finished streaming. `"Met"` triggers nothing; `"Metric"` does.
3. `validate: "full"`: the validator must have loaded and the props must pass.
   An implementation only ever receives parsed props. `validate: "server"` (a
   same-origin route only) never loads the validator.
4. Implementation arrived: render. Still loading: a busy placeholder that
   already holds the children. Failed: the host's fallback, reported once per
   document and retried on the next document, not on the next frame.

## How it reconciles

`applyPatch` shares structure, so an untouched subtree is the *same object* in
the next frame:

- Same node object, nothing pending inside: the whole subtree is skipped.
- Same props object: the element is kept, and only its children are reconciled.
- New props: the template runs again and the element is patched in place, so a
  streaming string updates one text node.
- Children are matched by `key`, else by type and position.

**Tested** by applying every prefix of three realistic streams (each 2
characters at a time, in both validation tiers) and checking that the DOM after
each frame equals a from-scratch render of that frame. Unchanged nodes are
checked to be the same DOM objects. Three deliberate bugs in the reconciler were
each caught.

## Output safety

Independent of what a template returns:

- Text is only ever a text node.
- Tags pass an allowlist: no `script`, `iframe`, `object`, form controls, SVG
  `use`, …
- Attributes pass an allowlist: no `on*`, `style` or `srcdoc`.
- `href` and `src` go through the URL guard again.
- SVG is created in the SVG namespace.

## Lazy loading, measured

A page with the renderer and the lazy base theme, before any document arrives,
loads **4.1 KB gzip and no component code**. A test builds that page with
esbuild and checks that no component code is in the entry chunk or anything it
imports statically. Each component group is fetched on first use: layout
0.5 KB, text 0.7 KB, Metric 0.5 KB, Table 0.4 KB, Chart 1.3 KB.
