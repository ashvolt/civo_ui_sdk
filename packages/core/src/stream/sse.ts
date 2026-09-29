import { RelaxUIError } from "../errors.js";

export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

const DONE = "[DONE]";

/**
 * Decodes a `text/event-stream` body into events.
 *
 * Written against `ReadableStream` rather than Node streams so the same code
 * path serves Node, Bun, Deno, Cloudflare Workers and the Vercel Edge runtime —
 * the environments a Next.js route handler can actually be deployed to.
 */
export async function* decodeSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      if (signal?.aborted) {
        throw new RelaxUIError({ code: "aborted", message: "Stream aborted by caller." });
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; tolerate CRLF and bare LF.
      let boundary = findBoundary(buffer);
      while (boundary !== null) {
        const raw = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const event = parseEventBlock(raw);
        if (event) yield event;
        boundary = findBoundary(buffer);
      }
    }

    buffer += decoder.decode();
    const tail = parseEventBlock(buffer);
    if (tail) yield tail;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function findBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function parseEventBlock(block: string): SSEEvent | null {
  const lines = block.split(/\r?\n/);
  const dataLines: string[] = [];
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;

  for (const line of lines) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // Per the spec a single leading space after the colon is stripped.
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "data":
        dataLines.push(value);
        break;
      case "event":
        event = value;
        break;
      case "id":
        id = value;
        break;
      case "retry": {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) retry = parsed;
        break;
      }
      default:
        break;
    }
  }

  if (dataLines.length === 0 && event === undefined) return null;
  const result: SSEEvent = { data: dataLines.join("\n") };
  if (event !== undefined) result.event = event;
  if (id !== undefined) result.id = id;
  if (retry !== undefined) result.retry = retry;
  return result;
}

/** True for the sentinel OpenAI-compatible servers send to close a stream. */
export function isStreamTerminator(event: SSEEvent): boolean {
  return event.data.trim() === DONE;
}
