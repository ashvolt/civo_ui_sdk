# html-host: `<gen-ui>` with no framework

A plain HTML page with four `<gen-ui>` elements, each in its own shadow root:

| Element | Theme | Source | Validation |
|---|---|---|---|
| `#base` | base theme | the SDK's route, same origin | `server`: the validator is never downloaded |
| `#bootstrap` | Bootstrap 5, stylesheet adopted into the shadow root | a static document | full |
| `#shoelace` | Shoelace's own elements | a `ReadableStream` | full |
| `#custom` | base theme, re-branded by two lines of the page's CSS | a static document | full |

`light.html` shows Bootstrap in `light` mode, where the page loads Bootstrap
itself. `empty.html` registers the element and renders nothing.

```sh
pnpm build                                   # the workspace packages
pnpm --filter relax-ui-example-html dev      # http://127.0.0.1:3300
pnpm --filter relax-ui-example-html test:e2e
```

`serve.mjs` serves every page with
`script-src 'self'; style-src 'self'`, with no `unsafe-eval` and no
`unsafe-inline`. Every script and stylesheet comes from the page's own origin.
`POST /api/ui` is a local stand-in for the SDK's route. It streams a fixed
document, so no model is needed.

The connectors are in [src/connectors](src/connectors):

- [bootstrap5.ts](src/connectors/bootstrap5.ts) is a class mapping, with no
  code. Chart is not mapped, so it falls back to the base theme, and the page
  shows that it did.
- [shoelace.ts](src/connectors/shoelace.ts) is an element mapping. Its dark theme
  follows the element's `variant` through an adopted sheet and a class.

The browser tests check:

- no CSP violation and no console error;
- a page that renders nothing loads no component code and no validator;
- a same-origin route never downloads Zod;
- no style crosses a shadow boundary in either direction;
- a variant switch restyles without re-rendering;
- axe passes in light and dark.
