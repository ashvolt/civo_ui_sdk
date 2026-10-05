# Troubleshooting

Symptoms first, because that is what you have when something breaks.

---

## Configuration

### `config_invalid: Missing relaxAI API key`

`RELAX_API_KEY` is not visible to the process.

- **Running `pnpm probe`**: put it in a `.env` at the repository root (copy
  `.env.example`). `pnpm probe` loads it via Node's `--env-file-if-exists`, so no
  `export` is needed — but the file must be at the root, since the flag resolves
  relative to the working directory. An exported shell variable works too.
- **In Next.js**: `.env.local`, then restart the dev server — Next reads env
  files at boot, not per request.
- **In a Worker**: set it as a binding and pass `apiKey` explicitly.

### `config_invalid: Unknown inference provider "…"`

`RELAX_UI_PROVIDER` (or the `provider` option) names something that is not
registered. The message lists what is. This is deliberately not a fallback to
relaxAI: a typo that sends prompts to an endpoint nobody chose is worse than a
failed start.

Built in: `relaxai`, `ollama`, `lmstudio`, `llamacpp` (plus the aliases `local`,
`relax`, `lm-studio`, `llama.cpp`). Anything else is a `defineProvider` profile
passed in code.

### A local provider refuses its own base URL

```
sovereignty_violation: Host "gpu-box.internal" is not in the sovereignty allowlist (localhost, 127.0.0.1, [::1])
```

A built-in local profile may dial loopback only, and `OLLAMA_BASE_URL` cannot
change that — an environment variable can move the address, not widen who may
be dialled. To reach a runtime on another host, say so in code:

```ts
createClient({
  provider: "ollama",
  baseURL: "https://gpu-box.internal/v1",
  sovereignty: { allowedHosts: ["gpu-box.internal"] },
});
```

### `transport_error: Network failure talking to Ollama`

The local runtime is not running, or not on the address the profile expects.
`ollama serve`, then `curl http://127.0.0.1:11434/v1/models`. The error is
retryable, and the application starts regardless — it fails on the first
request, not at boot.

### `config_invalid: Ollama lists no chat-capable model`

Model discovery found only embedding models, or nothing. `ollama pull
qwen2.5:3b`, or name a model with `RELAX_UI_MODEL`.

### `sovereignty_violation: Host "…" is not in the sovereignty allowlist`

`baseURL` points somewhere the allowlist does not cover. Either it is a typo, or
you genuinely have an in-jurisdiction gateway — in which case vouch for it:

```ts
new RelaxClient({ baseURL: "https://gateway.internal", sovereignty: { allowedHosts: ["gateway.internal"] } });
```

This fires at construction, on purpose: a misconfigured endpoint should fail the
deploy rather than quietly send prompts somewhere unintended.

### `sovereignty_violation: Refusing to send prompts over http://`

Use https. For a local gateway only:

```ts
new RelaxClient({ baseURL: "http://localhost:8080/v1", sovereignty: { allowInsecureTransport: true } });
```

The opt-in works for loopback hosts only — it cannot unlock a remote host.

### `capability_unsupported: Model "…" is not a chat model`

You passed an embeddings model to a chat endpoint. This fires before a request is
spent.

---

## Generation quality

### `schema_violation` that survives repair

The model cannot satisfy the schema. In order of likelihood:

1. **Descriptions are too thin.** `.describe()` on fields and `description` on
   components is the single biggest lever on output quality. `value: z.number()`
   tells the model nothing; `"Revenue in GBP millions, one decimal place"` does.
2. **A constraint the model cannot know.** `z.string().uuid()` for a field the
   model must invent, or a `.regex()` it cannot infer. Generate such values
   server-side instead.
3. **A refinement over multiple fields.** `.refine(d => d.end > d.start)` is
   invisible to the model unless the description says so.
4. **The schema is very large.** Split it, or raise `maxRepairAttempts`.

Inspect what actually failed:

```ts
onEvent: (e) => { if (e.type === "repair_attempt") console.warn(e.issues); }
```

### `truncated: The model stopped at its token limit`

`finish_reason` came back as `length` and the document was incomplete. This is a
budget problem, not a schema problem, and the SDK reports it separately because
the remedies are different — re-asking the identical request cannot help, so no
repair round is spent on it.

1. **Raise `sampling.max_tokens`.** A nested component tree is expensive; a dense
   dashboard runs to well over a thousand tokens on its own.
2. **Account for reasoning traces.** A model that thinks before it answers
   (qwen3, and the reasoning families generally) spends that budget first. The
   SDK strips the trace from the output; it cannot strip it from the bill.
3. **Ask for less.** Fewer components, or a shallower tree.

The local demo in `examples/next-app` hits all three at once: a small model, a
seven-component registry and a reasoning trace. Its budget is set accordingly in
`app/provider.ts`.

### A small model repeats the example from a prop's `description`

`describe("Pre-formatted, e.g. '£1.2m'")` and every metric comes back as
`£1.2m`. Wherever the model can read the schema — the prompted tier, or any
endpoint that shows it — a literal example is the most available answer, and a
3b model takes it. Measured on `llama3.2:3b`: two of two generations.

Describe the *form* instead of giving an instance ("a formatted figure with its
unit"), or accept it as the cost of the prompted tier on a small model. On
Ollama's constrained tier the model is not shown the schema at all, which is
why the same registry does not do this there.

### `metadata.repairAttempts` is consistently 1

Repair is working, and you are paying double for every generation. Treat it as a
prompt or schema problem, not a model problem.

### `metadata.strategy` is `prompted_json` when you expected better

Either the capability table has this model at the floor, or a downgrade happened.
Check `metadata.downgradedFrom`. If the model *does* support tool calling, correct
the table:

```ts
new RelaxClient({ capabilities: new CapabilityRegistry({ "your-model": { toolCalling: true } }) });
```

The shipped priors come from Civo's published documentation rather than live
probing — see [`plan.md` known limitations](../specs/001-generative-ui-sdk/plan.md#known-limitations).
A correction here is expected, not a bug report.

### The model returns prose instead of JSON

Normally handled by the extraction funnel. If it persists, check whether
`reasoningTrace` is set for the model — an unstripped `<think>` block is the usual
cause:

```ts
client.capabilitiesFor("your-model").reasoningTrace  // should be true for R1, GPT-OSS, GLM
```

---

## Streaming

### Everything arrives at once, at the end

Something is buffering. The SDK sets `X-Accel-Buffering: no` and
`Cache-Control: no-transform`, but a CDN or reverse proxy in front of your app may
still buffer. Check with `curl -N` against the route directly — if curl streams and
the browser does not, the proxy is the culprit.

Also check `frameIntervalMs`: a large value coalesces frames by design.

### On a local model, the whole document appears in one frame

The generation ran on the `tool_call` tier. Ollama buffers a tool call and
delivers its arguments in a single chunk, so there is nothing to stream:
`meta`, one `snapshot`, `complete`. Correct, and not what you wanted.

The Ollama profile prefers `native_json_schema`, which streams token by token,
so check why it was not used — `pnpm frames` prints the ladder:

- an older Ollama that refuses `response_format: json_schema` (upgrade; 0.5+);
- `forceStrategy` or `allowStrategies` excluding it;
- a custom `CapabilityRegistry` passed to the client without the profile's
  `endpointDefaults`.

### `schema_violation` on every local generation, with props you never registered

The endpoint accepted `response_format: json_schema` and did not enforce it.
Ollama 0.35 does this when the schema contains a `pattern` keyword: 200, no
warning, unconstrained output. The built-in `ollama` profile keeps `pattern` off
the wire for exactly this reason (the application's schema still validates it).

If you see it anyway you are probably not going through the profile — a
`RelaxClient` pointed at a local base URL, or a `defineProvider` profile without
a `schemaDialect`. Use `createClient({ provider: "ollama" })`, or add
`schemaDialect: { unsupportedKeywords: ["pattern"] }` to your own.
[ADR-0008](./adr/0008-wire-schema-dialects.md) has the bisection.

### `Error: UI stream out of order: expected seq 2, received 4`

Frames were dropped or interleaved. Almost always two streams sharing one
accumulator — call `submit()` (which aborts the previous stream) rather than
constructing a second reader. The accumulator throws rather than render a mixture
of two documents, which would be an unreproducible rendering bug.

### The stream ends with no `complete` frame

Look at the last frame: there will be an `error`. `schema_violation` mid-stream
means a fatal issue was detected and the upstream generation was aborted
deliberately — see the fail-fast path in
[the streaming pipeline](./diagrams/04-streaming-pipeline.md). `truncated` means
the model ran out of budget rather than getting anything wrong.

On a `schema_violation` the frame's `error.details` names the offending paths
(redacted to path and issue code), which is usually enough to see the problem
without a server log.

If your UI reads `strategy` without also reading `metadata`, note that the first
arrives with the opening `meta` frame and the second only with `complete`:
rendering the former alone makes a failed generation look like a finished one.

### `stream_malformed: … returned a streaming response with no body`

The upstream returned 200 with no body. Retry; if persistent, the model or gateway
is unhealthy.

---

## Rendering

### Nodes silently do not appear

A node failed validation in the renderer and `onInvalidNode` defaults to rendering
nothing. Make it visible:

```tsx
onInvalidNode={(f) => <pre>rejected {f.type}: {f.reason} {f.detail}</pre>}
```

`invalid_props` with a `detail` naming a field is the common case, and usually
means the registry and the component map disagree about that component.

### `unknown_type` for a component that is registered

The registry passed to `GenerativeUI` is not the one that produced the schema.
Use `createGenerativeRenderer` to bind them once — that is what it is for.

### A link does not render

`urlString()` rejected it. By default only `https:`, `http:`, `mailto:` and `tel:`
pass, plus relative paths. If you set `allowedHosts`, the host must match too.

### React warns about keys during streaming

The model is not supplying `key`. Ask for it in the component description; the
renderer falls back to `type:index`, which remounts siblings when a list grows.

---

## HTTP

### `payment_required` (402)

`A valid payment method is required to use RelaxAI API.` The key authenticated
fine — this is a billing gate, not an auth failure, which is why it has its own
code rather than being folded into `http_error`. Add a payment method in the
relaxAI dashboard; nothing in your code needs to change. It is never retried,
because retrying cannot help.

### `rate_limited` (429)

The SDK honours `Retry-After` and retries with full jitter. Persistent 429s mean
you need application-level queueing — `authorize` is the seam.

### `timeout` after 120s

Large documents on a slow model. Raise `timeoutMs`, lower `max_tokens`, or simplify
the schema. Local providers default to 300s rather than 120s: CPU inference of a
nested document routinely outlasts two minutes, and a cold model load comes out
of the same allowance. The route adapter's `timeoutMs` overrides either. Note that `timeout` is retryable and `aborted` is not — they are
deliberately distinct codes.

### `metadata.downgradedFrom` contains a tier the server never refused

The mechanism was accepted and the model returned nothing through it — most
often a forced tool call that a small model simply did not make. The SDK moves
down a tier rather than re-asking the one that went unanswered. Unlike a
refusal, this is **not** remembered: the next generation tries that tier again.

### A 401 does not trigger a strategy downgrade

Correct. Only a *capability rejection* downgrades. An auth failure propagates,
because silently downgrading would mask it as a quality problem.

---

## Build and types

### `Could not find a declaration file for module 'react-dom/server'`

Add `@types/react-dom` as a dev dependency.

### `ZodObject is not assignable to ZodType<never>`

You are annotating a `ComponentSpecMap` manually. Don't — let inference do it, or
use `satisfies`. Background in [LLD §10.2](./lld.md#102-the-type-system-problem-worth-recording).

### `config_invalid: Zod kind "map" has no JSON Schema representation`

`z.map`, `z.set`, `z.promise` and `z.function` cannot be expressed as JSON Schema.
Restructure (a record instead of a map), or supply the schema yourself:

```ts
defineStructuredSchema({ name: "X", schema: mySchema, jsonSchema: { /* … */ } });
```

This throws rather than emitting `{}` because `{}` would tell the model "anything
goes" for a field that has real constraints — a silent mis-description that
surfaces as an unexplained validation failure much later.

---

## Getting useful diagnostics

```ts
const { object, metadata } = await generateObject({
  client, model, schema, prompt,
  onEvent: (e) => console.log("[relax-ui]", e),
});
console.log(metadata);   // strategy, downgradedFrom, repairAttempts, usage, durationMs
```

On the route:

```ts
createGenerativeUIRoute({
  /* … */
  onEvent: (e) => logger.info({ relaxui: e }),
});
```

`metadata` and trace events never contain prompt or completion text, so they are
safe to log in full.
