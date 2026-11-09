# relax-ui-protocol

The browser half of the relaxAI Generative UI SDK's wire protocol. It turns the
SDK's event stream into a document, from any source, and does nothing else: no
client, no model, no validation library, **no dependencies**.

`relax-ui-core` compiles this package in and re-exports all of it, so server
code needs nothing new. A browser host that only renders documents can use this
package alone.

## Install

```sh
pnpm add relax-ui-protocol
```

## Use

```ts
import { readSource, resolveValidation, UIStreamAccumulator } from "relax-ui-protocol";

const source = { socket: new WebSocket("wss://example.com/ui") };
const tier = resolveValidation(source, "full"); // "server" here would throw config_invalid

const doc = new UIStreamAccumulator();
for await (const event of readSource(source)) {
  doc.apply(event);
  render(doc.current()); // validate first when tier is "full"
}
```

## Sources

| Source | Read as | Ends at | Ends early |
|---|---|---|---|
| `{ document }` | one `snapshot` (a copy; non-JSON values refused) | after it | — |
| `{ url }` | POST, then SSE — as the SDK's route has always been read | stream close | — |
| `{ stream }` | SSE framing from any `ReadableStream<Uint8Array>` | `complete`, `error`, `[DONE]` | `truncated` |
| `{ socket }` | one event per message (text, ArrayBuffer, typed array or Blob) | `complete`, `error`, `[DONE]` | `truncated` |

Every kind is folded by the same `UIStreamAccumulator`, with protocol 1's
sequencing. A socket is never closed by the reader: it belongs to the host and
may carry other traffic, so stopping only removes the reader's listeners.

## Trust

`resolveValidation(source, requested)` returns `"full"` unless `"server"` is
requested for an **http(s) URL on the page's own origin**. Any other source
asking to skip browser validation is refused with `config_invalid`, never quietly
upgraded. Origin is the only boundary a browser can check that the page cannot
forge ([research R4](../../specs/003-pluggable-generative-ui/research.md)).

## Exports

| Area | Exports |
|---|---|
| Events | `UIStreamEvent` and its five kinds, `isUIStreamEvent`, `encodeUIStreamEvent`, `UI_STREAM_PROTOCOL_VERSION` |
| Document | `UIStreamAccumulator`, `applyPatch`, `diffJson`, pointer helpers |
| Reading | `readSource`, `sourceKind`, `readUIStream`, `decodeSSE`, `isStreamTerminator` |
| Trust | `resolveValidation`, `isSameOriginUrl` |
| Errors | `RelaxUIError`, `isRelaxUIError` — recognised across copies of the package |
| Types | `JsonValue`, `GenerationMetadata`, `StructuringStrategyName`, `Source`, `SocketLike`, `ValidationTier` |

Size: about 3.7 KB gzip for the whole package, 3.3 KB for `readSource` with the
accumulator (`pnpm size`).
