# Reference application

A dashboard generator on the Next.js App Router, running the route handler on the
**Edge runtime**.

## Run it

```bash
cp .env.example .env.local     # add your RELAX_API_KEY
pnpm install                   # from the repository root
pnpm dev
```

## What to look at, and in what order

| File | Why it is worth reading |
|---|---|
| [`app/ui-registry.ts`](./app/ui-registry.ts) | The security boundary and the prompt, in one declaration. Seven components; adding one makes it available to the model, removing one makes the model structurally incapable of emitting it. |
| [`app/api/ui/route.ts`](./app/api/ui/route.ts) | The entire server side. Note what the browser cannot supply. |
| [`app/components.tsx`](./app/components.tsx) | Plain presentational React. No defensive checks, because props arrive validated twice — and no spread of model props onto a DOM element. |
| [`app/page.tsx`](./app/page.tsx) | The entire client side. `object.root` is partial for most of the stream and the renderer handles it. |

## Things to try

- **Watch the strategy.** The footer reports which tier ran. On Maverick expect
  `tool_call` — constrained decoding is not available, so the SDK negotiated down
  and said so.
- **Watch the frames.** The network panel shows readable JSON: `meta`, then
  `patch` frames carrying JSON Patch ops, then `complete`.
- **Break it on purpose.** Add a component to `components.tsx` that is not in the
  registry, or change a prop type in the registry without changing the component.
  In development `onInvalidNode` renders why the node was rejected.
- **Try a reasoning model.** Set `RELAX_MODEL=DeepSeek-V31-Terminus` and note that
  the `<think>` preamble never reaches the parser.

## Notes

`export const runtime = "edge"` works because the SDK's core requires nothing
beyond `fetch`, `ReadableStream` and `AbortController`. Verified with a real
`next build`.
