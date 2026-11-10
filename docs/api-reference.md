# API reference

Practical reference with examples. For the stability contract — what is public,
what bumps which version — see
[`contracts/public-api.md`](../specs/001-generative-ui-sdk/contracts/public-api.md).

---

## `relax-ui-core`

### `new RelaxClient(options?)`

```ts
const client = new RelaxClient({
  apiKey: process.env.RELAX_API_KEY,        // default: $RELAX_API_KEY, then $RELAXAI_API_KEY
  baseURL: "https://api.relax.ai/v1",       // default: $RELAX_BASE_URL, then this
  sovereignty: { allowedHosts: ["api.relax.ai"] },
  redaction: true,                          // false | true | RedactionRule[]
  onRedaction: (hits) => logger.warn({ hits }),
  retry: { maxRetries: 2, baseDelayMs: 400, maxDelayMs: 8_000 },
  timeoutMs: 120_000,
  headers: { "X-Tenant": "acme" },
  fetch: myFetch,                           // injection point for proxies and tests
  capabilities: new CapabilityRegistry({ /* corrections */ }),
  onAttempt: ({ attempt, status, delayMs }) => {},
});
```

Throws `config_invalid` with no key; `sovereignty_violation` for a
non-allowlisted host or plaintext HTTP. Both at **construction**, so
misconfiguration fails the deploy rather than the first user request.

| Method | Returns |
|---|---|
| `listModels(options?)` | `Promise<ModelDescriptor[]>` |
| `chatCompletion(request, options?)` | `Promise<ChatCompletionResponse>` |
| `streamChatCompletion(request, options?)` | `AsyncGenerator<ChatCompletionResponse>` |
| `capabilitiesFor(model)` | `ModelCapabilities` |

Construct it **once at module scope**. Per-request construction re-runs the
sovereignty check and discards the capability cache.

---

### `createClient(options?)` and provider profiles

```ts
createClient();                              // RELAX_UI_PROVIDER, else relaxAI
createClient({ provider: "ollama" });        // built-in: relaxai · ollama · lmstudio · llamacpp
createClient({ provider: defineProvider({ … }) });
new OpenAICompatibleClient({ provider });    // the same, ignoring the environment
```

`RelaxClient` is `OpenAICompatibleClient` with the provider fixed to relaxAI; it
never reads `RELAX_UI_PROVIDER`. All of them take the options above, plus
`provider`.

| Member | |
|---|---|
| `client.provider` | `{ id, label, sovereign, local }`. Only relaxAI is `sovereign` |
| `client.baseURL` | The resolved, guard-checked endpoint |
| `client.capabilities` | The registry for *this endpoint* |
| `client.schemaDialect` | Keywords this endpoint's constrained decoder cannot honour |

An unknown provider name throws `config_invalid`; it never falls back. A local
provider's egress policy is loopback-only, and an environment variable cannot
widen it.

```ts
const gateway = defineProvider({
  id: "uk-gateway", label: "UK inference gateway",
  baseURL: "https://llm.internal.example/v1",
  apiKeyEnv: ["GATEWAY_API_KEY"], requiresApiKey: true,
  egress: { allowedHosts: ["llm.internal.example"] },
  sovereign: false, local: false,
  capabilities: { jsonSchema: true },                    // optional
  schemaDialect: { unsupportedKeywords: ["pattern"] },   // optional
});
```

Full contract:
[provider-profile.md](../specs/002-provider-agnostic-inference/contracts/provider-profile.md).

### `InferenceClient`

What `generateObject`, `streamObject` and the route factories actually depend
on. Implement it to use a non-OpenAI protocol or an in-process model:

```ts
interface InferenceClient {
  readonly provider: ProviderDescriptor;
  readonly capabilities: CapabilityRegistry;
  readonly schemaDialect?: SchemaDialect;
  listModels(options?): Promise<ModelDescriptor[]>;
  chatCompletion(request, options?): Promise<ChatCompletionResponse>;
  streamChatCompletion(request, options?): AsyncIterable<ChatCompletionResponse>;
}
```

### Choosing a model on a local runtime

```ts
await discoverChatModel(client);       // asks /models, picks one; throws config_invalid if none
rankChatModels(ids); pickChatModel(ids); parseParamCount("qwen3:30b-a3b"); // 30
```

A heuristic — small, straight-answering chat models first; embeddings models
removed. Name a model explicitly when you know which you want.

### `defineStructuredSchema(options)`

```ts
const Triage = defineStructuredSchema({
  name: "Triage",                     // ^[A-Za-z][A-Za-z0-9_-]{0,63}$
  description: "Classification of an inbound support ticket.",
  schema: z.object({
    severity: z.enum(["low", "medium", "high", "critical"]),
    team: z.string().describe("Owning team, e.g. 'payments'"),
    summary: z.string().max(280),
  }),
  strict: true,                       // default; OpenAI strict-mode-shaped output
  // jsonSchema: { ... }              // escape hatch, overrides derivation
});
```

`description` and per-field `.describe()` are sent to the model and are the
largest single lever on output quality.

---

### `generateObject(options)`

```ts
const { object, metadata } = await generateObject({
  client, model: "Llama-4-Maverick-17B-128E", schema: Triage,
  prompt: ticketText,                 // or messages: ChatMessage[]
  system: "You triage support tickets.",
  sampling: { temperature: 0.2, max_tokens: 800 },
  allowStrategies: ["native_json_schema", "tool_call"],   // forbid the prompted floor
  forceStrategy: "tool_call",                             // skip negotiation
  maxRepairAttempts: 1,
  onEvent: (e) => logger.info({ e }),
  signal: controller.signal,
  timeoutMs: 60_000,
});
```

Resolves with a value that **passed the schema**, or rejects with a
`RelaxUIError`. There is no third outcome.

`metadata`: `{ requestId, model, strategy, downgradedFrom, repairAttempts, usage?, durationMs }`.

---

### `streamObject(options)`

Same options plus:

| Option | Default | Notes |
|---|---|---|
| `frameIntervalMs` | `0` | Minimum ms between frames. 0 emits per token; 40–60 suits dense trees |
| `transport` | `"patch"` | `"snapshot"` sends whole documents — larger, easier to debug |
| `now` | `performance.now` | Injected for deterministic throttle tests |

```ts
for await (const event of streamObject({ client, model, schema, prompt })) {
  switch (event.type) {
    case "meta":     console.log(event.strategy); break;
    case "patch":    doc = applyPatch(doc, event.ops); break;
    case "snapshot": doc = event.value; break;
    case "complete": return event.value;              // schema-valid
    case "error":    throw new Error(event.error.code);
  }
}
```

Never throws for a generation failure — failures arrive as an `error` frame,
because by then the HTTP status line is long gone.

---

### `toSSEStream(events)`

```ts
return new Response(toSSEStream(streamObject({ ... })), {
  headers: { "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" },
});
```

Pulls one event per `pull`, so backpressure reaches the upstream read: a slow
client slows the pipeline rather than buffering it. `cancel()` aborts upstream.

---

### `createUIRegistry(specs, options?)`

```ts
const registry = createUIRegistry({
  Stack:  { props: z.object({ gap: z.enum(["sm","md","lg"]).default("md") }),
            children: "required",
            description: "Vertical container. Use as the document root." },
  Metric: { props: z.object({ label: displayText(60), value: displayText(24) }) },
  Link:   { props: z.object({ label: displayText(80), href: urlString({ schemes: ["https:"] }) }) },
}, { maxNodes: 80, maxDepth: 6 });
```

| Member | Purpose |
|---|---|
| `nodeSchema` | Recursive discriminated union over registered types |
| `documentSchema` | `{ root: UINode }` + node/depth budget |
| `structuredSchema(name?, description?)` | Ready for `generateObject` / `streamObject` |
| `spec(type)` | Per-node lookup, used by the renderer |
| `names`, `limits`, `specs` | Introspection |

`children`: `"none"` (default, leaf — a `children` key is then a validation
failure), `"optional"`, `"required"` (≥1).

#### `urlString(policy?)` and `displayText(maxLength?)`

```ts
urlString({ schemes: ["https:"], allowedHosts: ["civo.com", "*.civo.com"], allowDataImages: false })
displayText(400)   // no control characters, bounded length
```

`urlString` refines **and** normalises, so `javascript:alert(1)` fails *schema
validation* — before a frame is sent. `z.string().url()` would accept it.

---

### `CapabilityRegistry`

```ts
const caps = new CapabilityRegistry({
  "our-finetune-v2": { jsonSchema: true, toolCalling: true, reasoningTrace: false },
});
caps.get("DeepSeek-R1-0528");          // merged prior + overrides
caps.observe("m", { toolCalling: true });
caps.markStrategyUnsupported("m", "native_json_schema");
CapabilityRegistry.baseline("m");      // prior only
```

Pass to a client as `capabilities`. Without one, every client of the same
endpoint shares a registry — relaxAI's is the process-wide
`defaultCapabilityRegistry` — so independent call sites share what they learn,
and what is learned about one endpoint is never applied to another.

A second argument, `{ endpointDefaults }`, sets capabilities the *server* confers
on every chat model it serves; it is how the Ollama profile says "constrained
decoding works here regardless of the model". Observations outrank it.

---

### `MetricsCollector`

```ts
const metrics = new MetricsCollector();
await generateObject({ ..., onEvent: metrics.handler });
metrics.snapshot();  // { generations, repairs, downgrades, strategyUsage }
```

No transport. It accepts no string from the model, so it cannot hold content.
Exporting is your call.

---

### Primitives

```ts
parsePartialJson('{"a":1,"b":"hal')   // { state: "partial", value: { a: 1, b: "hal" } }
completePartialJson('{"a":1,"ti')     // '{"a":1}'   — partial key discarded
diffJson(before, after)               // JsonPatchOp[]
applyPatch(doc, ops)                  // structurally shares untouched subtrees
extractJsonText(raw, { stripReasoning: true })
sanitizeUrl("javascript:alert(1)")    // null
redact("card 4111 1111 1111 1111")    // { text, hits, redacted }
measureTree(root)                     // { nodes, depth } — iterative
decodeSSE(body, signal?)
```

---

### `RelaxUIError`

```ts
try { await generateObject({ ... }); }
catch (e) {
  if (isRelaxUIError(e)) {
    switch (e.code) {
      case "rate_limited":   return retryLater(e);
      case "schema_violation": return fallbackUI();
      case "sovereignty_violation": throw e;    // configuration bug, not runtime
    }
  }
}
```

Codes: `config_invalid`, `sovereignty_violation`, `transport_error`, `http_error`,
`rate_limited`, `payment_required`, `timeout`, `aborted`, `stream_malformed`,
`no_content`, `truncated`,
`schema_violation`, `unrepairable`, `capability_unsupported`, `guard_rejected`.

`truncated` is kept separate from `schema_violation` on purpose: the model ran
out of tokens rather than misunderstanding the schema, so the remedy is a larger
`max_tokens` or a smaller document, and re-asking unchanged cannot help. The SDK
detects it from `finish_reason: "length"` and skips the repair round it would
otherwise spend arriving at the identical truncation.

Branch on `code`, never on message text. `toJSON()` is safe in an HTTP response.

---

## `relax-ui-react`

### `useGenerativeObject(options)`

```tsx
const { object, value, isStreaming, error, metadata, strategy, provider, submit, stop, reset } =
  useGenerativeObject<{ root: UINode }>({
    api: "/api/ui",
    schema: registry.documentSchema,     // optional client-side re-validation
    headers: { "X-Trace": traceId },
    credentials: "include",
    onComplete: (v, m) => analytics.track("ui_generated", { strategy: m.strategy }),
    onError: (e) => toast(e.code),
    onFrame: (event) => console.debug(event.type),   // observe every frame
  });
```

Any source, not only the route (feature 003):

```tsx
useGenerativeObject<{ root: UINode }>({ source: { socket: ws }, schema: contract.documentSchema });
useGenerativeObject<{ root: UINode }>({ source: { url: "/api/ui" }, validate: "server" }); // same origin only
```

`source` takes `{ url }`, `{ stream }`, `{ socket }` or `{ document }`. Anything
but a same-origin URL is validated in full against `schema` (required there).
`validate: "server"` with any other source is `config_invalid`. A same-origin
`api` keeps its original behaviour.

| Field | Notes |
|---|---|
| `object` | `Partial<T>` while streaming, full `T` after `complete` |
| `value` | Set only once the schema has passed |
| `strategy` / `provider` | From the opening `meta` frame: the mechanism that produced the document, and the inference provider's id (`relaxai`, `ollama`, …) |
| `onFrame(event)` | An observer, called with every frame before it is applied. For a devtools panel or a test; it cannot change what renders |
| `submit(body)` | Aborts any in-flight generation first |
| `stop()` / `reset()` | Cancel; cancel and clear |

Unmount aborts the request. A stream nobody will read should not keep an inference
running.

### `GenerativeUI` / `createGenerativeRenderer`

```tsx
const Dashboard = createGenerativeRenderer(registry, {
  Stack:  ({ props, children }) => <section style={{ gap: props.gap }}>{children}</section>,
  Metric: ({ props }) => <div><small>{props.label}</small><b>{props.value}</b></div>,
  Link:   ({ props }) => <a href={props.href} rel="noopener noreferrer">{props.label}</a>,
} as never, {
  onInvalidNode: (f) => process.env.NODE_ENV === "development"
    ? <pre>rejected {f.type}: {f.reason} {f.detail}</pre> : null,
  placeholder: <Skeleton />,
});

<Dashboard node={object?.root} />
```

`createGenerativeRenderer` also takes a contract (`standardContract.extend(…)`),
and the base theme as components:

```tsx
import { baseComponents, createGenerativeRenderer, GenerativeTheme } from "relax-ui-react";
const Doc = createGenerativeRenderer(contract, baseComponents);
<GenerativeTheme variant="dark" density="compact"><Doc node={object?.root} /></GenerativeTheme>
```

Components receive props already validated twice. `onInvalidNode` fires for
`unknown_type`, `invalid_props` and `depth_exceeded`, and defaults to rendering
nothing.

### `readUIStream(body, signal?)`

For a non-React client. Pair with `UIStreamAccumulator` so you share the server's
definition of "what the document is".

---

## `relax-ui-next`

### `createGenerativeUIRoute(config)`

```ts
export const runtime = "edge";
const client = new RelaxClient();

export const POST = createGenerativeUIRoute({
  client,
  model: "Llama-4-Maverick-17B-128E",
  schema: dashboardSchema,
  inputSchema: z.object({ topic: z.string().min(3).max(300) }),
  system: "You design compact analytics dashboards.",
  toMessages: (input, request) => [{ role: "user", content: `Dashboard about: ${input.topic}` }],
  sampling: { temperature: 0.4, max_tokens: 2_000 },
  authorize: async (request) => {
    const session = await getSession(request);
    return session ? undefined : new Response("Unauthorized", { status: 401 });
  },
  frameIntervalMs: 50,
  onEvent: (e) => logger.info({ relaxui: e }),
});
```

`model`, `schema`, `system` and `sampling` are fixed here and cannot be supplied
by the browser. `authorize` runs before any inference; returning a `Response`
short-circuits.

### `createGenerativeObjectRoute(config)`

Same config, returns `{ object, metadata }` as JSON. Status mapping:
`rate_limited` → 429, `timeout` → 504, `aborted` → 499,
`schema_violation`/`unrepairable`/`truncated` → 502, `config_invalid` → 500.

---

## Browser packages (feature 003)

Render generated documents in any host, from any source, with any theme library.
[ADR-0009](./adr/0009-own-reconciler-on-structural-sharing.md) to
[ADR-0012](./adr/0012-mount-contract-for-framework-components.md) record why
they are built this way. The [security model, §4.7](./security-model.md)
records what they defend.

| Package | Use it for | Runtime deps |
|---|---|---|
| `relax-ui-protocol` | Reading a document from any source; the trust decision | none |
| `relax-ui-contract` | The twelve standard components, your additions, and browser validation | protocol (Zod is a peer) |
| `relax-ui-theme-base` | The base theme: tokens, variants, templates, lazy loaders, `theme.css` | none |
| `relax-ui-render` | The render core, the DOM renderer, `defineConnector` | none |
| `relax-ui-element` | `<gen-ui>` | none (contract and Zod are optional peers) |
| `relax-ui-connect-react` / `-vue` / `-angular` | React, Vue or Angular component libraries as connectors | their framework, as a peer |

### `relax-ui-protocol`

```ts
import { readSource, resolveValidation, UIStreamAccumulator, type Source } from "relax-ui-protocol";

const source: Source = { socket: ws };       // or { url }, { stream }, { document }
const tier = resolveValidation(source, "full"); // "server" is refused here: a socket is foreign

const doc = new UIStreamAccumulator();
for await (const event of readSource(source, { body: { topic }, signal })) {
  doc.apply(event);
  render(doc.current());
}
```

| Export | Notes |
|---|---|
| `Source` | Exactly one of `{ document }`, `{ url }` (POSTed, SSE response), `{ stream }` (SSE bytes) or `{ socket }` (one event per message) |
| `readSource(source, options?)` | Protocol 1 events from any source. A stream or socket that ends before `complete` throws `truncated`. A socket is never closed: the host owns it |
| `resolveValidation(source, requested)` | `"full"`, or `"server"` only for an http(s) URL on the page's origin. Anything else with `"server"` is `config_invalid` ([ADR-0011](./adr/0011-same-origin-trust-boundary.md)) |
| `isSameOriginUrl(url, origin?)` | The check behind it. Protocol-relative URLs to another host are not same-origin |
| `UIStreamAccumulator`, `applyPatch`, `encodeUIStreamEvent`, `sanitizeUrl`, `measureTree` | The wire protocol's primitives, as in `relax-ui-core`, which re-exports all of them |

### `relax-ui-contract`

```ts
import { createValidator, standardContract, urlString, displayText } from "relax-ui-contract";
import { z } from "zod";

export const contract = standardContract.extend(
  {
    Timeline: {
      description: "Dated events, oldest first.",
      role: "list",                           // required: the ARIA role a theme gives its root
      children: "none",
      props: z.object({ events: z.array(z.object({ date: displayText(20), text: displayText(120) })).max(20) }).strict(),
    },
  },
  { maxNodes: 120 },
);

export const validator = createValidator(contract); // load lazily: it pulls in Zod
```

| Export | Notes |
|---|---|
| `standardContract` | Stack, Grid, Card, Heading, Text, Metric, List, Table, Callout, Badge, Link, Chart, each with a role and a schema |
| `defineContract(specs, limits?)` / `contract.extend(additions, limits?)` | Adds or overrides components and never removes one. Refuses a malformed name, a missing role, or an action prop (`onClick`, `action`, …) |
| `contract.names`, `contract.spec(type)`, `contract.role(type)`, `contract.documentSchema` | What the server's registry and the browser read |
| `createValidator(contract)` | `{ props(type, raw) }` for `<gen-ui>`'s `validator` or `DomRenderer`. Failures report field paths, never values |
| `buildUISchemas(specs, limits)` | The one schema builder both `createUIRegistry` (server) and the browser use |

On the server, `createUIRegistry(contract.specs, contract.limits)`
derives the JSON Schema the model is constrained by. Both ends read one
declaration.

### `relax-ui-theme-base`

| Export | Notes |
|---|---|
| `relax-ui-theme-base/theme.css` | Tokens and component styles for a page that links a stylesheet. Every rule is scoped under `.gen-theme` |
| `baseTemplates` | The twelve, loaded up front |
| `baseLoaders` | The twelve, loaded on first use, in five chunks: layout, text, Metric, Table, Chart |
| `themeAttributes(variant, density)` | `class` and `data-gen-*` for a root: variants `light`, `dark`, `auto`; densities `comfortable`, `compact` |
| `tokens`, `components`, `themeCss` | The CSS as strings, e.g. for an adopted stylesheet |

Override any `--gen-*` token in CSS to re-brand. Nothing re-renders.

### `relax-ui-render`

```ts
import { createCatalog, DomRenderer } from "relax-ui-render";
import { baseLoaders } from "relax-ui-theme-base";

const renderer = new DomRenderer(container, {
  catalog: createCatalog({ loaders: baseLoaders, preload: ["Stack"] }),
  types: contract.names,
  validate: "full",
  validator: () => import("./validator").then((m) => m.validator),
  onReport: (r) => console.warn(r.reason, r.type, r.detail),
});
renderer.render(doc.current()?.root, { complete: done });
```

| Export | Notes |
|---|---|
| `DomRenderer` | Keyed reconciler on the protocol's structural sharing. `render(root, { complete })`, `startDocument()` (failed loads may retry), `destroy()` (also unmounts framework components) |
| `createCatalog({ templates?, loaders?, preload? })` | A loader is called once per page, when its exact type first appears in a document |
| `Resolver` | The per-node decision every renderer shares, React included |
| `RenderReport.reason` | `unknown_type`, `invalid_props`, `depth_exceeded`, `load_failed`, plus the notices `fallback` and `override` |
| `defineConnector(options)` | See below |
| `layerConnectors({ types, base, connectors })` | Base theme first, then connectors in order; reports overrides and fallbacks |

Output safety applies whatever a template or connector returns: text is a text
node; tags and attributes pass allowlists; `href`/`src` pass the URL guard again.

### `relax-ui-element`

```html
<script type="module">import "relax-ui-element/define";</script>

<gen-ui id="ui" source="/api/ui" validate="server" variant="dark" density="compact" preload="Stack Metric"></gen-ui>
```

```ts
el.connectors = [bootstrap5];
el.contract = contract;                  // default: the standard contract
el.source = { stream: response.body };   // a string is a URL, as the attribute is
await el.submit({ topic });              // URL sources: POST the body, then read
el.stop();
el.addEventListener("gen-ui:state", (e) => console.log(e.detail.status, e.detail.fallbacks));
```

| Attribute | Values |
|---|---|
| `source` | a URL; or set the `source` property to any `Source` |
| `validate` | `full` (default) · `server`, same-origin URL only |
| `mode` | `shadow` (default) · `light`. Fixed once on the page |
| `variant` / `density` | `light` · `dark` · `auto` / `comfortable` · `compact`. Restyles, never re-renders |
| `preload` | types to load now |

| Property | Notes |
|---|---|
| `source` | Any kind except a URL starts reading as soon as the element is on the page; a URL waits for `submit()` |
| `connectors` | Layered after the base theme |
| `contract` | Anything with `names` (and optionally `limits`, `spec`) |
| `validator` | Overrides the default, which lazily imports `relax-ui-contract` |
| `fallback` | `(report) => Node \| null` for a node that will not render |
| `state` | `{ status, strategy, provider, metadata, error, fallbacks, loadFailures, overrides, refused }`, a copy |

| Event (bubbles, composed) | `detail` |
|---|---|
| `gen-ui:state` | the state above |
| `gen-ui:frame` | one protocol event |
| `gen-ui:complete` | `{ value, metadata }` |
| `gen-ui:error` | `{ code, message, details? }` |

`defineGenUI(name = "gen-ui")` registers the element under a name, once.

### `defineConnector(options)`

```ts
defineConnector({
  name: "bootstrap-5",
  kind: "class",                         // "class" | "element" | "framework"
  mode: "light",                         // what the library needs
  stylesheets: ["/vendor/bootstrap.css"],// adopted into a shadow root, once per page
  variants: { dark: { "data-bs-theme": "dark" } },
  requires: () => getComputedStyle(document.documentElement).getPropertyValue("--bs-primary") !== "",
  implementations: {
    Callout: { classes: { root: "alert", tone: { warning: "alert-warning" }, title: "alert-heading" } },
    Badge:   () => import("./badge").then((m) => m.badge), // a loader
  },
});
```

| Implementation | Kind | What it can do |
|---|---|---|
| `{ tag?, classes }` | `class` | Map the base theme's classes. `gen-x` maps to `root`, `gen-x__part` to `part`, `gen-tone--v` to `tone.v`, and `gen-x--v` to `variant.v`. Unmapped `gen-` classes are dropped |
| `{ tag, props?, slots? }` | `element` | The root becomes a custom element. Attributes come from props (`{ from, map }`); base parts go into named slots. `on*`, `style`, `href`, `src` are refused |
| `{ template }` | any | Markup as data |
| `{ mount }` | `framework` | See the connector packages |

A missing library (`requires` false) is `config_invalid` naming it. A `light`
connector with no stylesheet, used in `shadow` mode, is refused.

### `relax-ui-connect-react`, `-vue`, `-angular`

```tsx
reactConnector({ name: "mui", implementations: { Card: GenCard, Table: lazyComponent(() => import("./GenTable")) } });
vueConnector({ name: "element-plus", app, implementations: { Card: GenCard } });
angularConnector({ name: "angular-material", injector: inject(EnvironmentInjector), implementations: { Card: GenMatCard } });
```

A component receives the node's validated props. The renderer's children go
into React's `children`, Vue's default slot, or Angular's `<ng-content>`. Each
component's root should carry the contract's role. The element must be in
`mode="light"`. Samples: MUI (`packages/connect-react/samples`), Element Plus
(`examples/vue-host`) and Angular Material (`examples/angular-host`).

---

## Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `RELAX_UI_PROVIDER` | `createClient` | Provider name. Unset → `relaxai`. Unknown → throws |
| `OLLAMA_BASE_URL` · `LMSTUDIO_BASE_URL` · `LLAMACPP_BASE_URL` | that provider | Moves the address; cannot widen the loopback-only allowlist |
| `OLLAMA_API_KEY` · `LMSTUDIO_API_KEY` · `LLAMACPP_API_KEY` | that provider | Optional; sent only if set |
| `RELAX_API_KEY` | `RelaxClient` | Server only. Never `NEXT_PUBLIC_*` |
| `RELAXAI_API_KEY` | `RelaxClient` | Fallback |
| `RELAX_BASE_URL` | `RelaxClient` | Still subject to the sovereignty allowlist |
