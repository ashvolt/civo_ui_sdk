# Contract — Provider Profiles and the Inference Client

**Scope**: `relax-ui-core` public API added by feature 002
**Status**: stable from 0.2.0. Additive to feature 001's
[public API](../../001-generative-ui-sdk/contracts/public-api.md); nothing there
is removed or changes meaning.

---

## Selecting a provider

```ts
import { createClient, RelaxClient, OpenAICompatibleClient } from "relax-ui-core";

new RelaxClient();                           // relaxAI. Cannot be redirected.
createClient();                              // RELAX_UI_PROVIDER, else relaxAI.
createClient({ provider: "ollama" });        // a built-in, by name.
createClient({ provider: myProfile });       // one the application defined.
new OpenAICompatibleClient({ provider });    // as createClient, ignoring the environment.
```

| Constructor | Reads `RELAX_UI_PROVIDER` | Default |
|---|---|---|
| `new RelaxClient(options)` | never | relaxAI |
| `new OpenAICompatibleClient(options)` | never | relaxAI |
| `createClient(options)` | only when `options.provider` is absent | relaxAI |

**Guarantees**

1. **No fallback.** An unregistered provider name throws `config_invalid` and
   lists the registered names. No client is returned.
2. **Names are forgiving, not fuzzy.** Case and surrounding whitespace are
   ignored, and a fixed alias table is consulted (`local` → `ollama`, `relax` →
   `relaxai`, `lm-studio` → `lmstudio`, `llama.cpp` / `llama-cpp` → `llamacpp`).
   Nothing is matched by similarity.
3. **The guard always runs.** `assertSovereignEndpoint(baseURL, policy)` is
   called in the constructor for every provider, where `policy` is
   `options.sovereignty ?? profile.egress`.
4. **The environment can move an endpoint, not widen who may be dialled.** A
   profile's `baseURLEnv` may supply a different address; it is checked against
   the same policy. Only `options.sovereignty` — code — replaces the policy.
5. **Keyless means no header.** With no key configured, no `Authorization`
   header is sent. A key that *is* configured is sent, required or not.

---

## Environment variables

| Variable | Read by | Meaning |
|---|---|---|
| `RELAX_UI_PROVIDER` | `createClient` | Provider name. Unset → `relaxai` |
| `RELAX_API_KEY`, `RELAXAI_API_KEY` | `relaxai` | API key (required) |
| `RELAX_BASE_URL` | `relaxai` | Base URL override |
| `OLLAMA_BASE_URL`, `OLLAMA_API_KEY` | `ollama` | Override / optional key |
| `LMSTUDIO_BASE_URL`, `LMSTUDIO_API_KEY` | `lmstudio` | Override / optional key |
| `LLAMACPP_BASE_URL`, `LLAMACPP_API_KEY` | `llamacpp` | Override / optional key |

Empty and whitespace-only values are treated as unset.

---

## Defining a provider

```ts
import { defineProvider } from "relax-ui-core";

export const gateway = defineProvider({
  id: "uk-gateway",
  label: "UK inference gateway",
  baseURL: "https://llm.internal.example/v1",
  apiKeyEnv: ["GATEWAY_API_KEY"],
  requiresApiKey: true,
  egress: { allowedHosts: ["llm.internal.example"] },
  sovereign: false,          // true only if this endpoint makes that guarantee
  local: false,
  capabilities: { jsonSchema: true },                 // optional
  schemaDialect: { unsupportedKeywords: ["pattern"] } // optional
});
```

`defineProvider` throws `config_invalid` when:

- `id` does not match `^[a-z][a-z0-9-]{0,31}$`;
- `baseURL` is not an absolute URL;
- `sovereign` is true and `egress.allowInsecureTransport` is true.

The returned profile is frozen.

**What a profile cannot do**: run code. It has no hooks, no request transformer,
no response parser. An endpoint that needs those is a different wire protocol
and belongs behind its own `InferenceClient`.

---

## `InferenceClient`

```ts
interface InferenceClient {
  readonly provider: ProviderDescriptor;       // { id, label, sovereign, local }
  readonly capabilities: CapabilityRegistry;
  readonly schemaDialect?: SchemaDialect;
  listModels(options?: RequestOptions): Promise<ModelDescriptor[]>;
  chatCompletion(request, options?): Promise<ChatCompletionResponse>;
  streamChatCompletion(request, options?): AsyncIterable<ChatCompletionResponse>;
}
```

`generateObject`, `streamObject`, `createGenerativeUIRoute` and
`createGenerativeObjectRoute` accept any `InferenceClient`.

**Obligations on an implementation**

| Obligation | Why |
|---|---|
| Raise `RelaxUIError` with an HTTP-like `status` for a refused request | `isCapabilityRejection` reads `status` and `message`; anything else is not a downgrade |
| Honour `options.signal` | Caller cancellation must reach the model (feature 001, FR-025) |
| Yield chunks in order, and return when the upstream ends | The engine validates at end of iteration |
| Report `finish_reason: "length"` when the budget ran out | Distinguishes `truncated` from a schema violation |
| Tell the truth in `provider.sovereign` | The SDK passes it on; it cannot check it |

The SDK cannot enforce the last one against code it did not write. A
hand-written client is trusted exactly as far as the application that wrote it.

---

## Model selection helpers

```ts
rankChatModels(ids: string[]): string[]          // best first; non-chat models removed
pickChatModel(ids: string[]): string | undefined
discoverChatModel(client: InferenceClient): Promise<string>   // throws config_invalid
parseParamCount(id: string): number | undefined  // billions, from an Ollama-style tag
```

A heuristic for local runtimes, where the catalogue is whatever happens to be
installed. Order: size band (3–9b first), tool-capable family, straight-answering
before reasoning, smaller before larger. An application that knows which model it
wants names it and never calls these.

---

## Additions to existing types

| Type | Addition | Compatibility |
|---|---|---|
| `UIStreamMetaEvent` | `provider?: string` | Additive; protocol stays at 1 |
| `GenerationMetadata` | `provider?: string` | Additive |
| `GenerationTrace` | `{ type: "schema_adapted", provider, dropped }` | New union member; a `switch` with no `default` needs a case |
| `StrategyContext` | `wireSchema?: JsonSchema` | Additive |
| `StructuringStrategy` | `fallbackDeltaOf?(chunk)` | Additive, optional |
| `CapabilityRegistry` | second constructor argument `{ endpointDefaults }` | Additive |
| `HttpClientOptions` | `upstream?: string` | Additive |
| `UseGenerativeObjectOptions` | `onFrame?(event)` | Additive |
| `GenerativeObjectState` | `provider: string \| undefined` | Additive |
| `GenerativeUIRouteConfig.client` | `RelaxClient` → `InferenceClient` | Widened; every existing call compiles |
| `GenerativeUIRouteConfig.timeoutMs` | default `120_000` → the client's default | Unchanged for relaxAI (its default *is* 120 000) |

## Behaviour changes

Each is a correction; none removes a capability.

| Before | Now |
|---|---|
| A failure before the first upstream request reached the browser as `transport_error`, with no `[DONE]` | It carries its own code, and the SSE body always ends with `[DONE]` |
| A forced tool call that returned nothing was re-asked on the same tier and ended in `no_content` | The next tier is tried; the downgrade is in `downgradedFrom` |
| `meta` was written on the first upstream chunk | `meta` is written with the first document frame |
| The batch fallback's `meta` named the strategy negotiated at the outset | It names the strategy the batch path ended on |
| `streamObject` emitted no `strategy_*` trace events | It emits the same ones `generateObject` does |
| A forced tool call answered as message text cost a second generation | The text is parsed |
| `12.` mid-stream dropped the member | The number is held at `12` |
