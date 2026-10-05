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

### …or against a local open-weight model, with no relaxAI account

```bash
ollama pull qwen2.5:3b         # or llama3.2:3b — once
RELAX_UI_PROVIDER=ollama pnpm dev
```

PowerShell: `$env:RELAX_UI_PROVIDER = "ollama"; pnpm dev`. Or put it in
`examples/next-app/.env.local` and just run `pnpm dev`:

```
RELAX_UI_PROVIDER=ollama
# RELAX_UI_MODEL=qwen2.5:7b     # optional: pin a model
```

Then open <http://localhost:3000/?frames=1> — the `?frames=1` opens the frame
inspector, so you can watch the stream being built as well as what it builds.

`lmstudio` and `llamacpp` work the same way, on their default ports.

Two things that catch people out: the file must live in **`examples/next-app/`**
(Next reads env files from the app directory, not the repository root), and
**restart the dev server** after editing it — a running server will keep serving
the old provider, banner and all.

A misspelt provider name stops the app with a message listing the valid ones. It
does not fall back to relaxAI: that would send prompts to an endpoint you did
not choose, and look like it had worked.

#### What happens on a local runtime

Measured against Ollama 0.35 (the details are in
[the feature's research notes](../../specs/002-provider-agnostic-inference/research.md)):

| | |
|---|---|
| **Tier used** | `native_json_schema`. Ollama compiles the schema to a grammar server-side, whatever the model, and streams token by token |
| **Frames** | a few hundred for a dashboard — `meta`, a handful of `snapshot`s, then one-op `patch`es |
| **Why not tool calling** | Ollama delivers a tool call whole, in one chunk: correct, and the page stays empty until the end |
| **Schema on the wire** | the app's schema minus `pattern`, which Ollama accepts and then silently stops enforcing. The app's own schema still validates every frame |

Timings on this laptop (CPU only), one dashboard each, all validated:

| Model | First paint | Finished | Frames |
|---|---|---|---|
| `llama3.2:1b` | 5 s | 26 s | 282 |
| `llama3.2:3b` | <1 s (warm) | 31 s | 185 |
| `qwen2.5:3b` | 7 s | 38 s | 234 |
| `qwen3:4b` (reasoning) | 65 s | 136 s | 220 |
| `qwen2.5:7b` | 119 s (cold load) | 173 s | 147 |

#### Which model gets picked

No API key and no model name are needed: the app asks the runtime's `/v1/models`
and picks the smallest one that can still do the job.

| Preference | Why |
|---|---|
| ~3b–9b band first (a 4b or 7b beats a 32b) | the demo should stream in seconds on a laptop, not swap for two minutes |
| tool-capable families next | matters only where the runtime cannot constrain decoding itself |
| straight-answering before reasoning | a reasoning model spends its first minute on tokens you never see |
| smaller before larger within the band | same reason as the first row |
| nothing under ~1b unless it is all you have | a 0.6b model cannot reliably emit a nested component tree |
| never an embeddings model | it is removed from the list, not ranked last |

Sizes are read from the Ollama tag, including the traps: `qwen3:30b-a3b` counts
as 30b rather than its 3b active experts, and `mixtral:8x7b` as 56b rather than
7b. Pin a specific model with `RELAX_UI_MODEL` (`OLLAMA_MODEL` still works).

**A local provider is not a way around the sovereignty guard.** The guard still
runs; the profile hands it a deliberately narrow policy — loopback hosts only,
plaintext permitted only because the traffic never leaves the machine — and
`OLLAMA_BASE_URL` can move the address but cannot widen it. The UI says plainly
that you are not on a sovereign endpoint. If that ever stops being obvious, the
demo is wrong.

### Check the frames from a terminal

```bash
pnpm frames                           # from the repository root, after `pnpm build`
pnpm frames -- --model llama3.2:3b --json frames.json
```

Prints each frame as it is created, then asserts the wire contract: `meta`
first, `seq` contiguous, one terminal frame, every intermediate document
tolerated by the schema, and replaying the frames reproduces the completed
value. Exit code 0 only if the generation completed and all of that held.

### Record the demo video

```bash
pnpm demo:record                      # a real model on local Ollama
DEMO_MODEL=qwen2.5:7b pnpm demo:record
DEMO_ENDPOINT=stub pnpm demo:record   # no model; a stand-in, labelled on screen
```

Writes `docs/demo/generative-ui-local-model.webm` and a still beside it.
[`demo/record.spec.ts`](./demo/record.spec.ts) drives this app in Chromium with
Playwright's recorder running, so the video is the real route, the real renderer
and a real model — the captions are the only thing the script adds.

## What to look at, and in what order

| File | Why it is worth reading |
|---|---|
| [`app/ui-registry.ts`](./app/ui-registry.ts) | The security boundary and the prompt, in one declaration. Seven components; adding one makes it available to the model, removing one makes the model structurally incapable of emitting it. |
| [`app/api/ui/route.ts`](./app/api/ui/route.ts) | The entire server side. Note what the browser cannot supply. |
| [`app/components.tsx`](./app/components.tsx) | Plain presentational React. No defensive checks, because props arrive validated twice — and no spread of model props onto a DOM element. |
| [`app/dashboard-page.tsx`](./app/dashboard-page.tsx) | The entire client side. `object.root` is partial for most of the stream and the renderer handles it. |
| [`app/provider.ts`](./app/provider.ts) | Which endpoint, which model, how patient. Everything endpoint-*specific* lives in the SDK's provider profiles; this file only chooses. |
| [`app/frame-inspector.tsx`](./app/frame-inspector.tsx) | The stream made visible, fed by the hook's `onFrame` observer. |

## Things to try

- **Watch the strategy.** The footer reports which tier ran. On Maverick expect
  `tool_call` — constrained decoding is not available, so the SDK negotiated down
  and said so.
- **Watch the frames.** Tick **Show frames** (or open `/?frames=1`) for one row
  per SSE event: `meta`, then `snapshot`/`patch` frames, then `complete`. The
  network panel shows the same thing as readable JSON.
- **Break it on purpose.** Add a component to `components.tsx` that is not in the
  registry, or change a prop type in the registry without changing the component.
  In development `onInvalidNode` renders why the node was rejected.
- **Try a reasoning model.** Set `RELAX_MODEL=DeepSeek-V31-Terminus` and note that
  the `<think>` preamble never reaches the parser.

## Run it with no model at all

`e2e/stub-endpoint.mjs` is a committed OpenAI-compatible stand-in. It serves one
model and streams a document that satisfies the registry:

```bash
SCHEMA=on DELAY_MS=40 node e2e/stub-endpoint.mjs 11437
RELAX_UI_PROVIDER=ollama OLLAMA_BASE_URL=http://127.0.0.1:11437/v1 pnpm dev
```

| Variable | Effect |
|---|---|
| `SCHEMA=on` | honours `response_format: json_schema`, as a current local runtime does. Omit it and the stub refuses with a 400, so a run exercises a real downgrade to tool calling |
| `DELAY_MS=40` | paces the chunks so the stream is watchable. Omit for instant |
| `MODE=truncate` | stops mid-document with `finish_reason: length`; the page reports `truncated` |
| `MODE=badtype` | sends a `Metric` whose `value` is a number; the page names the offending path |
| `MODE=emptytool` | a forced tool call returns nothing; the page shows the downgrade to `prompted_json` |

## Browser tests

```bash
pnpm test:e2e          # from the repository root, or `playwright test` here
```

Twenty tests drive this app in Chromium against that stand-in. They cover the
joins the unit tests cannot: SSE frames reaching the hook, patches reaching the
renderer, the negotiated tier and provider appearing in the footer, the frame
inspector listing the stream, and every failure path reporting what failed. The
endpoint is a stand-in on purpose — a real model returns a different document
every run, and a test that asserts on model output is a test of the model.

There are two stand-ins and two instances of the app, from one build:

| Project | Endpoint | What it shows |
|---|---|---|
| `modern-runtime` | honours `json_schema` | the constrained tier, the schema dialect on the wire, the frame inspector |
| `legacy-runtime` | refuses `json_schema` | the downgrade, that the refusal is **remembered** on the next request, and that an empty tool call is not |

Two, because the SDK remembers what an endpoint refused for the life of the
process. One app against an endpoint that changed its mind between tests would
be asserting against state the previous test had deliberately poisoned.

If your container ships its own Chromium rather than Playwright's, point at it
with `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium`.

## Notes

`export const runtime = "edge"` works because the SDK's core requires nothing
beyond `fetch`, `ReadableStream` and `AbortController` — verified with a real
`next build`. This route ships as `nodejs` only because a local provider has to reach
a runtime on `127.0.0.1`, which an Edge deployment has no loopback for.
