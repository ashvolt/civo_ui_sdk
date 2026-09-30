# Contract — relaxAI upstream (consumed)

**Direction**: SDK → relaxAI
**Base URL**: `https://api.relax.ai/v1`
**Auth**: `Authorization: Bearer $RELAX_API_KEY`

What the SDK assumes about relaxAI, and — more usefully — what it refuses to
assume. Every "assumed" row below is a claim the SDK can survive being wrong
about; every "relied upon" row is load-bearing.

> Verified against Civo's published documentation, not against live calls: this
> build environment's egress policy blocks `relax.ai`. `scripts/probe-models.ts`
> turns each assumption below into a measurement — `pnpm build && RELAX_API_KEY=...
> pnpm probe` — and prints where reality disagrees with the priors.

---

## Endpoints used

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/chat/completions` | All structured generation |
| `GET` | `/models` | Catalogue discovery (`RelaxClient.listModels`) |

Embeddings, audio and deep-research endpoints exist on relaxAI and are out of
scope for this feature (see `spec.md` → Out of Scope).

---

## Relied upon (breaking if untrue)

| Property | Detail |
|---|---|
| OpenAI-shaped request body | `model`, `messages[{role, content}]`, `stream` |
| OpenAI-shaped response body | `choices[0].message.content` / `choices[0].delta.content` |
| Bearer auth | `Authorization: Bearer <key>` |
| SSE streaming | `data:` frames of `chat.completion.chunk` objects, terminated by `data: [DONE]` |
| Conventional status codes | 400 class for client error, 429 for rate limit, 5xx for server error |

These are exactly the guarantees "1:1 OpenAI compatibility" makes, and the SDK
depends on no more than that.

---

## Assumed, and falsified at runtime

| Property | Prior | If wrong |
|---|---|---|
| `response_format: {type: "json_schema"}` | per-model, from the capability table | 400 → downgrade to tool calling, remember |
| `response_format: {type: "json_object"}` | assumed true for chat models | Server ignores it; repair loop still converges |
| `tools` + forced `tool_choice` | per-model | 400 → downgrade to prompted JSON, remember |
| `strict: true` inside `json_schema` / tool params | honoured where implemented | Unknown keyword; ignored |
| `seed` determinism | best effort | No behavioural dependency |
| `usage` on streamed responses | may be absent | `metadata.usage` omitted |
| `x-request-id` response header | may be absent | SDK generates its own `requestId` |
| `Retry-After` on 429 | honoured when present | Falls back to full-jitter backoff |
| `discriminator` keyword in JSON Schema | ignored by servers that do not implement guided decoding | Harmless; `anyOf` carries the real constraint |

The table is the design. Anything in this section can be wrong without breaking
the SDK, because the floor strategy (`prompted_json`) needs no server feature at
all — it needs only a chat model.

---

## Request shapes, per strategy

### Tier 1 — `native_json_schema`

```json
{
  "model": "DeepSeek-V4-Pro",
  "messages": [{ "role": "user", "content": "..." }],
  "response_format": {
    "type": "json_schema",
    "json_schema": { "name": "Dashboard", "schema": { "...": "..." }, "strict": true }
  }
}
```

JSON text is read from `choices[0].message.content` (or `delta.content`).

### Tier 2 — `tool_call`

```json
{
  "model": "Llama-4-Maverick-17B-128E",
  "messages": [{ "role": "user", "content": "..." }],
  "tools": [{
    "type": "function",
    "function": { "name": "Dashboard", "description": "...", "parameters": { "...": "..." }, "strict": true }
  }],
  "tool_choice": { "type": "function", "function": { "name": "Dashboard" } }
}
```

`tool_choice` names the function rather than using `"auto"`: this is not offering
the model a choice, it is using the tool channel as a typed return value.

JSON text is read from `choices[0].message.tool_calls[0].function.arguments` (or
the corresponding `delta.tool_calls[0].function.arguments`). Some servers answer a
forced `tool_choice` with plain content anyway, so the reader falls back to
`message.content` before failing.

### Tier 3 — `prompted_json`

```json
{
  "model": "DeepSeek-R1-0528",
  "messages": [
    { "role": "system", "content": "Respond with a single JSON document and nothing else...\n{...schema...}" },
    { "role": "user", "content": "..." }
  ],
  "response_format": { "type": "json_object" }
}
```

The instruction is appended to an existing leading system message rather than
inserted before it, so the application's own system prompt keeps primacy.

---

## Response handling

### Text extraction funnel

Applied in order to the accumulated completion:

1. **Strip reasoning wrappers** when `capabilities.reasoningTrace` —
   `<think>…</think>`, `<thinking>`, `<reasoning>`, `<|channel|>analysis` …
   `<|channel|>final`. While a wrapper is still *open*, the extractor yields the
   empty string: handing prose to a partial JSON parser produces garbage,
   yielding nothing correctly means "not started".
2. **Strip markdown fences**, including an unclosed one.
3. **Take from the first `{` or `[`.**
4. **Drop trailing chatter** after the final `}`/`]`.

### Error classification

| Upstream | SDK `code` | `retryable` |
|---|---|---|
| Network failure, DNS, reset | `transport_error` | yes |
| Client abort | `aborted` | no |
| Per-request timeout | `timeout` | yes |
| 429 | `rate_limited` | yes |
| 408, 409, 425, 500, 502, 503, 504 | `http_error` | yes |
| Other 4xx | `http_error` | no |
| 200 with no content | `no_content` | no |

A 400/404/422/501 whose message mentions `response_format`, `json_schema`,
`guided`, `tool`, `function`, or a generic "not supported" is additionally
classified as a **capability rejection**, which triggers a downgrade instead of
an error.

Matching on message text is unlovely. It is also unavoidable:
OpenAI-compatible servers are inconsistent about how they report an unsupported
feature, and the alternative — failing the request — is worse than a heuristic
whose false-negative case is simply "no downgrade happened".

---

## Retry policy

- Attempts: 1 + `maxRetries` (default 2).
- Backoff: full jitter, `random() * min(base * 2^attempt, maxDelay)`, base 400ms,
  ceiling 8s. Full jitter rather than plain exponential so a fleet of pods does
  not retry in lockstep.
- `Retry-After` overrides our backoff: a rate limit is the server's call.
- Only `retryable` failures are retried. A 401 is never retried.
- Retries are per HTTP request. They compose with, and are independent of, the
  strategy ladder and the repair loop.

---

## Egress constraints (Principle I)

- The base URL host MUST be on the sovereignty allowlist; default `api.relax.ai`.
  Checked at client construction, so a misconfigured `RELAX_BASE_URL` fails the
  deploy rather than quietly exfiltrating prompts.
- `https` only, except an explicitly opted-in loopback for local development.
- These two endpoints are the **only** hosts the SDK ever contacts. There is no
  telemetry endpoint, no version check and no error reporter.
