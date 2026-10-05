# Quickstart — a local open-weight model, no relaxAI account

**Feature**: 002-provider-agnostic-inference

This is the acceptance test for the feature's first success criterion: with
Ollama running and no relaxAI key anywhere, one environment variable yields a
streamed, validated dashboard.

---

## 1. See it run (two minutes)

```bash
ollama pull qwen2.5:3b            # or llama3.2:3b — any small chat model
pnpm install && pnpm build        # from the repository root

cd examples/next-app
RELAX_UI_PROVIDER=ollama pnpm dev
```

PowerShell: `$env:RELAX_UI_PROVIDER = "ollama"; pnpm dev`. Or put the line in
`examples/next-app/.env.local` and run `pnpm dev`.

Open <http://localhost:3000/?frames=1> and press **Generate**.

What you should see:

- an amber banner naming **Ollama (127.0.0.1:11434)** and saying it is not a
  sovereign endpoint;
- the layout assembling on the left, a component at a time;
- on the right, one row per frame: `meta` (naming `native_json_schema`, the model
  and `ollama`), a few `snapshot`s, then a long run of `patch`es, then `complete`;
- a footer: `Structured via native_json_schema on qwen2.5:3b (ollama) in …ms`.

No model is named anywhere: the app asked Ollama what was installed and picked
the smallest one likely to manage a nested document. Pin one with
`RELAX_UI_MODEL=qwen2.5:7b`.

---

## 2. Check the frames from a terminal

```bash
pnpm frames                                   # auto-picked model on Ollama
pnpm frames -- --model llama3.2:3b
pnpm frames -- --model qwen2.5:7b --force tool_call
pnpm frames -- --json frames.json             # keep the frames
```

It prints every frame as it is created and then asserts the wire contract:

```
endpoint  Ollama (http://127.0.0.1:11434) sovereign=false
model     qwen2.5:3b
schema    Dashboard

   6724ms  meta      model=qwen2.5:3b strategy=native_json_schema provider=ollama
   6724ms  snapshot  seq=1 {}
   7068ms  snapshot  seq=2 {"root":{}}
   7428ms  snapshot  seq=4 {"root":{"type":"Stack"}}
   8730ms  patch     seq=13 ops=1 [{"op":"add","path":"/root/props","value":{}}]
   …
  40396ms  complete  strategy=native_json_schema downgradedFrom=[] repairs=0 40393ms

frames    286 total — 272 patch, 12 snapshot, 55831 bytes on the wire
timing    first paint 6724ms, finished 40396ms
invariants all held
result    OK — validated Dashboard document
```

Exit code 0 means the stream completed *and* every invariant held. Use it after
upgrading a local runtime: it is how the Ollama profile's two refinements were
measured, and how you would find out they had changed.

---

## 3. Use a local provider in your own code

The only line that differs from feature 001's quickstart is the client.

```ts
// app/api/ui/route.ts
import { createClient } from "relax-ui-core";
import { createGenerativeUIRoute } from "relax-ui-next";

export const runtime = "nodejs";              // a local runtime needs loopback

const client = createClient();                // RELAX_UI_PROVIDER, else relaxAI

export const POST = createGenerativeUIRoute({
  client,
  model: process.env.RELAX_UI_MODEL ?? "Llama-4-Maverick-17B-128E",
  schema: dashboardSchema,
  inputSchema: InputSchema,
  toMessages: (input) => [{ role: "user", content: `Build a dashboard about: ${input.topic}` }],
});
```

Three ways to choose the endpoint, in increasing order of "fixed in code":

```ts
createClient();                         // the deployment decides (environment)
createClient({ provider: "ollama" });   // this code decides
new RelaxClient();                      // relaxAI, and nothing can redirect it
```

To let the endpoint choose the model:

```ts
import { discoverChatModel } from "relax-ui-core";

let model: Promise<string> | undefined;
export const POST = createGenerativeUIRoute({
  client,
  model: () => (model ??= discoverChatModel(client)),
  …
});
```

---

## 4. Show which endpoint is serving

```tsx
const { object, provider, strategy, metadata } = useGenerativeObject({ api: "/api/ui" });
// provider === "ollama" once the opening frame arrives
```

On the server, before any request: `client.provider` is
`{ id, label, sovereign, local }`. The reference app uses it to render the
banner. A local provider is never `sovereign`.

---

## 5. Watch frames in your own UI

```tsx
const { object } = useGenerativeObject({
  api: "/api/ui",
  onFrame: (event) => console.debug(event.type, "seq" in event ? event.seq : ""),
});
```

`onFrame` is an observer. The frame was validated on the server before it was
sent, and nothing it returns changes what renders.

---

## 6. Another endpoint entirely

```ts
import { createClient, defineProvider } from "relax-ui-core";

const gateway = defineProvider({
  id: "uk-gateway",
  label: "UK inference gateway",
  baseURL: "https://llm.internal.example/v1",
  apiKeyEnv: ["GATEWAY_API_KEY"],
  requiresApiKey: true,
  egress: { allowedHosts: ["llm.internal.example"] },
  sovereign: false,
  local: false,
});

const client = createClient({ provider: gateway });
```

Or skip the SDK's client and implement `InferenceClient` yourself — four
methods and two properties. See
[contracts/provider-profile.md](./contracts/provider-profile.md).

---

## 7. Regenerate the demo video

```bash
pnpm build
pnpm demo:record                          # real model on local Ollama
DEMO_MODEL=qwen2.5:7b pnpm demo:record    # pin the model
DEMO_ENDPOINT=stub pnpm demo:record       # no model; a stand-in, labelled on screen
```

Writes `docs/demo/generative-ui-local-model.webm` and a still beside it. It
drives the real app in Chromium, so what is recorded is what a user would see.

---

## What refuses, and how

| You did | You get |
|---|---|
| `RELAX_UI_PROVIDER=olama` | `config_invalid` — `Unknown inference provider "olama". Built-in providers: relaxai, ollama, lmstudio, llamacpp.` |
| `OLLAMA_BASE_URL=http://10.0.0.5:11434/v1` | `sovereignty_violation` — refuses plaintext to a non-loopback host |
| `OLLAMA_BASE_URL=https://ollama.example.com/v1` | `sovereignty_violation` — host not in the allowlist (`localhost, 127.0.0.1, [::1]`) |
| Ollama not running | one `error` frame, `transport_error`, retryable |
| Only an embeddings model installed | `config_invalid` from discovery; `capability_unsupported` if you name it |
| relaxAI with no key | `config_invalid` — names `RELAX_API_KEY` |

To reach a runtime on another host you must say so in code:
`createClient({ provider: "ollama", baseURL, sovereignty: { allowedHosts: ["gpu-box.internal"] } })`.
An environment variable alone cannot.
