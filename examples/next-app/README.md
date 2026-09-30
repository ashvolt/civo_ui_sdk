# Reference application

A dashboard generator on the Next.js App Router, running the route handler on the
**Edge runtime**.

## Run it

Against relaxAI, which is the point of the SDK:

```bash
cp .env.example .env.local     # add your RELAX_API_KEY
pnpm install                   # from the repository root
pnpm dev
```

### …or against local Ollama, with no relaxAI account

```bash
ollama serve                   # in another terminal
RELAX_UI_PROVIDER=ollama pnpm dev
```

Or put it in `examples/next-app/.env.local` and just run `pnpm dev`:

```
RELAX_UI_PROVIDER=ollama
OLLAMA_MODEL=qwen3:4b
```

Two things that catch people out: the file must live in **`examples/next-app/`**
(Next reads env files from the app directory, not the repository root), and
**restart the dev server** after editing it — a running server will keep serving
the old provider, banner and all.

### Prefer a model that does not think

    ollama pull qwen2.5:3b      # or llama3.2:3b

A reasoning model (qwen3, deepseek-r1) spends hundreds of tokens inside
`<think>` before the first character of the answer. Measured here on qwen3:4b
at 13 tok/s: a two-field probe burned ~430 completion tokens thinking, and the
full Dashboard schema ran for nine minutes before failing. Ollama's
OpenAI-compatible route gives no way to turn it off — `think: false`,
`chat_template_kwargs.enable_thinking` and Qwen's own `/no_think` were each
tested against it and each ignored. (`think: false` does work on Ollama's
native `/api/chat`, which this SDK does not speak.)

The auto-pick deprioritises reasoning models for that reason, but it can only
choose among what you have pulled.

No API key needed. The model is **auto-discovered** from whatever you have
pulled — it asks Ollama's `/v1/models` and picks the smallest one that can still
do the job:

| Preference | Why |
|---|---|
| ~3b–9b band first (a 4b or 7b beats a 32b) | the demo should stream in seconds on a laptop, not swap for two minutes |
| tool-capable families next | the ladder starts at tool calling rather than the prompted floor |
| smaller before larger within the band | same reason as the first row |
| nothing under ~1b unless it is all you have | a 0.6b model cannot reliably emit a nested component tree, and the SDK would wear the blame |

Sizes are read from the Ollama tag, including the traps: `qwen3:30b-a3b` counts
as 30b rather than its 3b active experts, and `mixtral:8x7b` as 56b rather than
7b. Pin a specific model with `OLLAMA_MODEL`.

This exists for two reasons. It lets anyone run and review the demo without an
account. And pointing the same code at a second, only-partly-compatible
OpenAI endpoint is the clearest demonstration of what the capability ladder is
*for*: Ollama and relaxAI disagree about constrained decoding and tool calling,
and the SDK negotiates that rather than assuming it away.

**Local mode is not a way around the sovereignty guard.** The guard still runs;
it is handed a deliberately narrow policy — loopback hosts only, plaintext
permitted only because the traffic never leaves the machine — and refuses
anything wider exactly as it would in production. The UI says plainly that you
are not on a sovereign endpoint. If that ever stops being obvious, the demo is
wrong.

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

## Run it with no model at all

`e2e/stub-endpoint.mjs` is a committed OpenAI-compatible stand-in. It serves one
model, streams a document that satisfies the registry, and refuses
`response_format: json_schema` the way Ollama does, so a run still exercises a
real downgrade to tool calling:

```bash
node e2e/stub-endpoint.mjs 11437
RELAX_UI_PROVIDER=ollama OLLAMA_BASE_URL=http://127.0.0.1:11437/v1 pnpm dev
```

Set `MODE=truncate` or `MODE=badtype` to watch the two failure paths instead: the
first stops mid-document with `finish_reason: length` and the page reports
`truncated`; the second sends a `Metric` whose `value` is a number and the page
names the offending path.

## Browser tests

```bash
pnpm test:e2e          # from the repository root, or `playwright test` here
```

Seven tests drive this app in Chromium against that stand-in. They cover the
joins the unit tests cannot: SSE frames reaching the hook, patches reaching the
renderer, the negotiated tier appearing in the footer, and both failure paths
reporting what failed. The endpoint is a stand-in on purpose — a real model
returns a different document every run, and a test that asserts on model output
is a test of the model.

If your container ships its own Chromium rather than Playwright's, point at it
with `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium`.

## Notes

`export const runtime = "edge"` works because the SDK's core requires nothing
beyond `fetch`, `ReadableStream` and `AbortController` — verified with a real
`next build`. This route ships as `nodejs` only because local mode has to reach
Ollama on `127.0.0.1`, which an Edge deployment has no loopback for.
