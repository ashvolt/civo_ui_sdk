# angular-host: `<gen-ui>` in an Angular app

An Angular 22 app, compiled ahead of time by the Angular CLI, with two
elements:

- `#base` uses the base theme in a shadow root and reads the SDK's route with
  `validate="server"`.
- `#material` uses Angular Material through
  [`relax-ui-connect-angular`](../../packages/connect-angular), in light mode. It
  renders a static document that is validated in full in the browser.

There is no Angular package for the element itself: `CUSTOM_ELEMENTS_SCHEMA`,
attributes in the template, and properties and listeners through a view child.

```sh
pnpm build                                      # the workspace packages
pnpm --filter relax-ui-example-angular dev      # http://127.0.0.1:3302
pnpm --filter relax-ui-example-angular test:e2e
```

The Angular CLI 22 needs Node 22.22.3 or later, or Node 24.

Scripts are `script-src 'self'`, and the page carries no Angular compiler.
Angular adds component styles at runtime, so styles are `'self'` plus a fresh
nonce per page (`ngCspNonce`), not `unsafe-inline`. Material's prebuilt theme
names Roboto with no fallback, so `src/styles.css` gives each typography role a
system fallback.
