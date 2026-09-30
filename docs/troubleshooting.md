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

### `Error: UI stream out of order: expected seq 2, received 4`

Frames were dropped or interleaved. Almost always two streams sharing one
accumulator — call `submit()` (which aborts the previous stream) rather than
constructing a second reader. The accumulator throws rather than render a mixture
of two documents, which would be an unreproducible rendering bug.

### The stream ends with no `complete` frame

Look at the last frame: there will be an `error`. `schema_violation` mid-stream
means a fatal issue was detected and the upstream generation was aborted
deliberately — see the fail-fast path in
[the streaming pipeline](./diagrams/04-streaming-pipeline.md).

### `stream_malformed: relaxAI returned a streaming response with no body`

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

### `rate_limited` (429)

The SDK honours `Retry-After` and retries with full jitter. Persistent 429s mean
you need application-level queueing — `authorize` is the seam.

### `timeout` after 120s

Large documents on a slow model. Raise `timeoutMs`, lower `max_tokens`, or simplify
the schema. Note that `timeout` is retryable and `aborted` is not — they are
deliberately distinct codes.

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
