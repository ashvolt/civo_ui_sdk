# relax-ui-react

React bindings for the [relaxAI Generative UI SDK](../../README.md): a streaming
object hook and an allowlist-only renderer.

**No credential, no model, no parser.** This package consumes the SDK's validated
event stream. By the time bytes reach it they describe a *validated object taking
shape* — everything that could be attacked happened on the server, where an
attacker cannot edit the code. That is [ADR-0001](../../docs/adr/0001-server-side-validation-boundary.md).

## Install

```bash
pnpm add relax-ui-react relax-ui-core zod
```

## Use

```tsx
"use client";
import { createGenerativeRenderer, useGenerativeObject } from "relax-ui-react";
import { registry } from "./ui-registry";

const Dashboard = createGenerativeRenderer(registry, {
  Stack:  ({ props, children }) => <section>{children}</section>,
  Metric: ({ props }) => <div><small>{props.label}</small><b>{props.value}</b></div>,
} as never);

export default function Page() {
  const { object, isStreaming, error, submit } = useGenerativeObject({ api: "/api/ui" });
  return (
    <>
      <button onClick={() => submit({ topic: "Q3 churn" })} disabled={isStreaming}>Generate</button>
      <Dashboard node={object?.root} />
    </>
  );
}
```

## Any source, not only your route

`api` reads your own route, as it always has. `source` reads anything else:

```tsx
useGenerativeObject({ source: { url: "/api/ui" }, schema });            // same-origin SSE
useGenerativeObject({ source: { stream: response.body }, schema });     // any ReadableStream in SSE framing
useGenerativeObject({ source: { socket: ws }, schema });                // a WebSocket, one event per message
useGenerativeObject({ source: { document: saved }, schema });           // a complete document
useGenerativeObject({ source: { url: "/api/ui" }, validate: "server" }); // trust your own origin's validation
```

A source other than a same-origin route is **validated in full in the
browser** — every frame, before it reaches state — so `schema` is required.
The first invalid frame stops the stream and sets `error` to
`schema_violation` with the field's path and issue code, never its value.

`validate: "server"` skips that, and is accepted **only for a same-origin
URL**. For a document, a stream, a socket or another origin it is refused with
`config_invalid` before anything is read: a browser cannot prove where those
came from.

| `api` / `source` | default | `validate: "server"` |
|---|---|---|
| `api` on this origin | trusted, as in earlier releases; `schema` re-checks the result only | same |
| `api` on another origin | full — needs `schema` | refused |
| `source: { url }` on this origin | full — needs `schema` | trusted |
| `source: { url }` elsewhere, `{ stream }`, `{ socket }`, `{ document }` | full — needs `schema` | refused |

How each ends: a socket or stream that stops before `complete` or `error` sets
`error` to `truncated`. A socket is never closed by the hook — `stop()` and
unmount only stop listening. A `document` has no generation behind it, so
`metadata` stays undefined and `onComplete` is not called.

## What the renderer guarantees

- A component the application did not register renders **nothing** (or your
  `onInvalidNode`), never a guess.
- Props are re-validated per node against that component's own schema.
- Model text reaches the DOM as text content. There is **no
  `dangerouslySetInnerHTML` in this package**, not as an option and not behind a
  flag — CI greps for it.
- Documents deeper than the registry's limit are cut off.

All four are already enforced server-side. They are done again here because a
control living in one layer is a control a misconfiguration silently removes.

## Streaming behaviour worth knowing

- `object` is `Partial<T>` during the stream and the full `T` after `complete`.
- Patches apply with **structural sharing**, so components on an untouched branch
  keep referential equality and skip re-rendering while the rest streams in.
- Model-supplied `key`s reconcile lists by identity — without them a growing list
  remounts every sibling several times a second, and inputs lose focus.
- `submit()` aborts any in-flight generation; unmount aborts too.

→ [API reference](../../docs/api-reference.md)
