# cross-host: one document, four hosts

T-256. One Playwright test loads the same document, from the same stand-in
route, in four hosts:

- the plain HTML page, through `<gen-ui>`;
- the Vue app, through `<gen-ui>`;
- the Angular app, through `<gen-ui>`;
- a React page, through `relax-ui-react` (`html-host/react.html`).

In each host it serialises the base theme's output (elements, sorted
attributes and text, in order) and asserts that all four are identical.

```sh
pnpm build && pnpm --filter relax-ui-example-cross-host test:e2e
```
