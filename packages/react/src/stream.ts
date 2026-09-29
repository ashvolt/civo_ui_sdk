import {
  decodeSSE,
  isStreamTerminator,
  isUIStreamEvent,
  type UIStreamEvent,
} from "@civo/relax-ui-core";

/**
 * Reads the SDK's SSE response into typed events.
 *
 * Extracted from the hook so the client's parsing boundary can be tested
 * without a DOM — and so a non-React consumer (a Svelte store, a plain script,
 * a server-side prerender) gets the same behaviour rather than a second, subtly
 * different implementation.
 *
 * Frames that are not well-formed SDK events are dropped rather than thrown on.
 * Proxies and dev tooling inject keep-alives and comments into event streams,
 * and a client that dies on one is a client that dies in production only.
 */
export async function* readUIStream<T>(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<UIStreamEvent<T>, void, unknown> {
  for await (const frame of decodeSSE(body, signal)) {
    if (isStreamTerminator(frame)) return;
    const data = frame.data.trim();
    if (data === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    if (!isUIStreamEvent(parsed)) continue;
    yield parsed as UIStreamEvent<T>;
  }
}
