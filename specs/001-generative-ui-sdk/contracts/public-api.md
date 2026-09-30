# Contract — public API surface

Everything exported from a package root is public and covered by semver.
Anything reachable only by a deep import is internal and may change in a patch.

---

## `@civo/relax-ui-core`

### Client

```ts
new RelaxClient(options?: RelaxClientOptions)
```

| Option | Default | Notes |
|---|---|---|
| `apiKey` | `$RELAX_API_KEY`, then `$RELAXAI_API_KEY` | Throws `config_invalid` if absent |
| `baseURL` | `$RELAX_BASE_URL`, then `https://api.relax.ai/v1` | Validated at construction |
| `sovereignty` | `{ allowedHosts: ["api.relax.ai"] }` | Throws `sovereignty_violation` on a non-allowlisted host |
| `redaction` | `false` | `true` for defaults, or supply `RedactionRule[]` |
| `onRedaction` | — | `(hits: Record<string, number>) => void` |
| `retry` | `{ maxRetries: 2, baseDelayMs: 400, maxDelayMs: 8000 }` | `random` and `sleep` injectable for tests |
| `timeoutMs` | `120_000` | Per request |
| `fetch` | `globalThis.fetch` | Injection point for tests and proxies |
| `capabilities` | `defaultCapabilityRegistry` | Process-shared by default |
| `headers` | — | Merged into every request |

Methods: `listModels()`, `chatCompletion()`, `streamChatCompletion()`,
`capabilitiesFor(model)`.

### Schema

```ts
defineStructuredSchema<T>({ name, schema, description?, jsonSchema?, strict? }): StructuredSchema<T>
toJsonSchema(zodSchema, { name?, strict? }): JsonSchema
safeParsePartial<T>(schema, value, finished?): PartialValidationResult<T>
classifyIssue(issue): "pending" | "fatal"
formatIssues(issues, limit?): string
redactIssues(issues): JsonValue
```

### Generation

```ts
generateObject<T>(options): Promise<{ object: T; metadata: GenerationMetadata }>
streamObject<T>(options): AsyncGenerator<UIStreamEvent<T>>
toSSEStream<T>(events): ReadableStream<Uint8Array>
```

Shared options: `client`, `model`, `schema`, and either `prompt` or `messages`;
plus `system?`, `sampling?`, `allowStrategies?`, `forceStrategy?`,
`maxRepairAttempts?` (default 1), `onEvent?`, `signal?`, `timeoutMs?`, `headers?`.
`streamObject` adds `frameIntervalMs?` (default 0), `transport?`
(`"patch" | "snapshot"`), `now?`.

**Guarantee**: `generateObject` resolves with a value that passed `schema`, or
rejects with a `RelaxUIError`. There is no third outcome.

### Generative UI

```ts
createUIRegistry<M>(specs: M, options?): UIRegistry<M>
urlString(policy?): ZodType<string>     // scheme/host-guarded, normalising
displayText(maxLength?): ZodType<string> // no control characters, bounded
measureTree(root): { nodes: number; depth: number }
```

### Capability

```ts
new CapabilityRegistry(seed?)
  .get(model) / .observe(model, patch) / .markStrategyUnsupported(model, strategy) / .snapshot()
CapabilityRegistry.baseline(model): ModelCapabilities
negotiateStrategy({ model, registry?, allow?, force? }): NegotiationResult
isCapabilityRejection(error, strategy): boolean
defaultCapabilityRegistry
```

### Protocol

```ts
UIStreamAccumulator<T>   // apply / current / meta / result / error / done
encodeUIStreamEvent(event): string
isUIStreamEvent(value): boolean
UI_STREAM_PROTOCOL_VERSION
```

### Primitives (exported because they are independently useful)

```ts
parsePartialJson(text): PartialParseResult
completePartialJson(text): string | null
diffJson(before, after): JsonPatchOp[]
applyPatch(doc, ops): JsonValue | undefined
toPointer(path) / fromPointer(pointer)
decodeSSE(body, signal?) / isStreamTerminator(event)
extractJsonText(raw, options?) / stripReasoning / stripCodeFences / JsonTextAccumulator
sanitizeUrl(raw, policy?) / assertSafeUrl / assertSovereignEndpoint / redact
MetricsCollector / emptyMetrics
```

### Errors

```ts
class RelaxUIError extends Error { code; retryable; status?; requestId?; strategy?; details?; toJSON() }
isRelaxUIError(value): boolean
```

---

## `@civo/relax-ui-react`

```ts
useGenerativeObject<T>({ api, schema?, headers?, credentials?, onComplete?, onError? })
  → { object, value, isStreaming, error, metadata, strategy, submit, stop, reset }
```

- `object` is `Partial<T>` while streaming, the full `T` after `complete`.
- `value` is set only once the schema has passed.
- `submit(body)` cancels any in-flight generation first.
- Unmount aborts the request — a stream nobody will read should not keep an
  inference running.

```tsx
<GenerativeUI registry components node onInvalidNode? placeholder? />
createGenerativeRenderer(registry, components, defaults?) → bound component
readUIStream<T>(body, signal?): AsyncGenerator<UIStreamEvent<T>>
```

`GenerativeUI` guarantees: unknown `type` → `onInvalidNode` (or nothing); props
failing the component's schema → `onInvalidNode`; depth over
`registry.limits.maxDepth` → `onInvalidNode`; no path from model output to raw
HTML.

---

## `@civo/relax-ui-next`

```ts
createGenerativeUIRoute<TInput, TObject>(config): (request: Request) => Promise<Response>
createGenerativeObjectRoute<TInput, TObject>(config): (request: Request) => Promise<Response>
```

Config: `client`, `model`, `schema`, `inputSchema`, `toMessages`, plus optional
`system`, `sampling`, `authorize`, `allowStrategies`, `maxRepairAttempts`,
`frameIntervalMs`, `transport`, `onEvent`, `timeoutMs`.

**The important part is what is absent.** `model`, `schema`, `system` and
`sampling` are fixed at construction and cannot be supplied by the browser. A
route that lets the client pick the model is a bill; one that lets it supply the
schema or system prompt is a jailbreak with a REST interface.

Neither handler imports `next`. They are `(Request) => Response`, which is what
the App Router wants and what the Edge runtime, Workers and a plain `fetch` test
all accept unchanged.

---

## Stability

| Change | Bump |
|---|---|
| New export, new optional field, new error code | MINOR |
| Removed export, renamed error code, changed default that alters behaviour | MAJOR |
| New capability-table entry, better prior for an existing model | PATCH |
| Wire protocol change | `UI_STREAM_PROTOCOL_VERSION`, independently |

Peer range: `zod@^3.23.0 || ^4.0.0`; `react@^18.2.0 || ^19.0.0`. Node ≥ 20.11.
