# Contract — UI Stream Protocol v1

**Direction**: application server → browser
**Transport**: `text/event-stream` over HTTP/1.1 or HTTP/2
**Status**: stable at `protocol: 1`

This is the contract that lets the browser stay ignorant of relaxAI. A client
that implements it correctly needs no knowledge of which model ran, which
structuring strategy was used, or what the raw completion looked like.

---

## Framing

Each frame is one SSE event whose `data` is a single-line JSON object:

```
data: {"type":"meta","protocol":1,...}\n\n
data: {"type":"patch","seq":1,"ops":[...]}\n\n
data: [DONE]\n\n
```

- Frames are separated by a blank line. Both `\n\n` and `\r\n\r\n` MUST be
  accepted.
- `data: [DONE]` terminates the stream. A client MUST stop reading at it and MUST
  ignore anything after it.
- Comment lines (`: keep-alive`) and empty `data:` frames MUST be ignored, not
  treated as errors. Proxies and dev tooling inject them.
- A `data:` payload that is not valid JSON, or is JSON but not a recognised event,
  MUST be skipped rather than fatal.

### Response headers

| Header | Value | Why |
|---|---|---|
| `Content-Type` | `text/event-stream; charset=utf-8` | |
| `Cache-Control` | `no-cache, no-transform` | `no-transform` stops proxies rewriting the body |
| `Connection` | `keep-alive` | |
| `X-Accel-Buffering` | `no` | Nginx and several CDNs buffer unknown content types by default, which silently turns a streaming route into a slow non-streaming one |

---

## Events

### `meta` — always first

```json
{
  "type": "meta",
  "protocol": 1,
  "requestId": "b7c1e0f2-...",
  "model": "Llama-4-Maverick-17B-128E",
  "schema": "Dashboard",
  "strategy": "tool_call"
}
```

| Field | Type | Notes |
|---|---|---|
| `protocol` | `1` | Client MUST reject an unknown major |
| `requestId` | `string` | Correlates client, server and provider logs |
| `model` | `string` | The model that actually answered |
| `schema` | `string` | `StructuredSchema.name` |
| `strategy` | enum | `native_json_schema` \| `tool_call` \| `prompted_json` |

Exactly one `meta`, before any other frame.

---

### `patch` — incremental update

```json
{
  "type": "patch",
  "seq": 3,
  "ops": [
    { "op": "add", "path": "/root/children/1", "value": { "type": "Metric", "props": {} } },
    { "op": "replace", "path": "/root/props/heading", "value": "Q3 revenue" }
  ]
}
```

- `ops` is an RFC 6902 subset: `add`, `replace`, `remove` only.
- `path` is an RFC 6901 pointer (`~0` for `~`, `~1` for `/`).
- Ops MUST be applied in array order.
- Array `remove` ops are emitted highest-index-first so every remaining index
  stays valid as ops apply.

---

### `snapshot` — full replacement

```json
{ "type": "snapshot", "seq": 7, "value": { "root": { "...": "..." } } }
```

Replaces the document outright. Sent when:

- the server is in `transport: "snapshot"` mode;
- a patch would be larger than the document it describes;
- an off-stream repair rewrote the document (patching a repaired object against a
  broken one is not meaningful);
- the model could not stream at all and the server fell back to a batch call.

---

### `complete` — terminal success

```json
{
  "type": "complete",
  "value": { "root": { "...": "..." } },
  "metadata": {
    "requestId": "b7c1e0f2-...",
    "model": "Llama-4-Maverick-17B-128E",
    "strategy": "tool_call",
    "downgradedFrom": ["native_json_schema"],
    "repairAttempts": 0,
    "usage": { "prompt_tokens": 412, "completion_tokens": 388, "total_tokens": 800 },
    "durationMs": 2143
  }
}
```

`value` **has passed the full schema**. That is the entire meaning of this frame:
a client may treat it as trusted-shape data and stop showing loading affordances.

---

### `error` — terminal failure

```json
{
  "type": "error",
  "error": {
    "code": "schema_violation",
    "message": "Streamed object violates schema \"Dashboard\" and cannot recover.",
    "retryable": false,
    "requestId": "b7c1e0f2-..."
  }
}
```

`code` is from the `RelaxUIError` set. `message` is SDK-authored and MUST NOT
contain prompt or completion text.

---

## Sequencing rules

1. `meta` first.
2. `seq` starts at 1 and increments by exactly 1 across `patch` and `snapshot`
   combined.
3. Exactly one terminal frame (`complete` or `error`). Nothing follows it.
4. A `seq` gap is **unrecoverable**. A patch assumes the exact document the
   server held, so a client MUST raise rather than render a mixture of two
   documents.

---

## Client algorithm

```
doc ← undefined
for each frame:
  meta     → record; reject unknown protocol major
  patch    → assert seq == last+1; doc ← applyPatch(doc, ops)
  snapshot → assert seq == last+1; doc ← value
  complete → doc ← value; mark done
  error    → mark failed
```

`UIStreamAccumulator` in `@civo/relax-ui-core` is the reference implementation,
used by both the React hook and the server's own tests, so client and server
cannot disagree about what the document is.

---

## Error transport: why failures arrive with HTTP 200

Once the first frame is written the status line is long gone. A failure after
that point can only travel in band, as an `error` frame on a 200 response.

Only failures *before* the stream opens use a status code:

| Condition | Status |
|---|---|
| Body is not JSON | 400 |
| Body fails the route's input schema | 400 |
| `authorize` hook rejects | whatever it returns |
| Anything after the stream opens | 200 + `error` frame |

A client MUST therefore treat `error` frames, not the status code, as the primary
failure signal.

---

## Security properties

- No frame carries prompt text, completion text, reasoning traces, or credentials.
- `value` in `snapshot` and `complete` has been schema-validated server-side.
- Validation failure details are reduced to codes and paths; values are never
  echoed, because a failing value may be personal data.
- The protocol is one-way. There is no client→server frame, so no client message
  can influence the generation once started.

---

## Compatibility

`protocol` is versioned independently of the npm package version.

- Adding an optional field to an existing event, or a new event type a client may
  ignore → no bump.
- Changing the meaning of a field, removing one, or adding an event a client MUST
  understand → major bump.

Clients MUST ignore unknown fields and MUST ignore unknown event types rather
than fail, so additive changes stay non-breaking.
