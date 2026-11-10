# vue-host: `<gen-ui>` in a Vue app

A Vue 3 app with two elements:

- `#base` uses the base theme in a shadow root and reads the SDK's route with
  `validate="server"`.
- `#element-plus` uses Element Plus through
  [`relax-ui-connect-vue`](../../packages/connect-vue), in light mode. It renders
  a static document that is validated in full in the browser.

There is no Vue package for the element itself: it is an ordinary element to
Vue, with attributes in the render function and properties and listeners on a
template ref.

```sh
pnpm build                                  # the workspace packages
pnpm --filter relax-ui-example-vue dev      # http://127.0.0.1:3301
pnpm --filter relax-ui-example-vue test:e2e
```

The page is served with `script-src 'self'; style-src 'self'`. It uses Vue's
runtime-only build with render functions, so there is no template compiler.
`public/app.css` darkens Element Plus's default palette, because some of its
text is below 4.5:1 contrast. The axe test checks the result.
