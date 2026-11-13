import { RelaxUIError } from "./errors.js";

export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

const DONE = "[DONE]";

/**
 * The longest event the reader holds, in characters (8 Mi). A document the
 * standard contract allows is far smaller; a stream that sends more in one
 * event, or never ends one, is refused before it can fill the page's memory.
 */
export const DEFAULT_MAX_EVENT_LENGTH = 8 * 1024 * 1024;

export interface DecodeSSEOptions {
  /** Refuse an event longer than this many characters. Default `DEFAULT_MAX_EVENT_LENGTH`. */
  maxEventLength?: number;
}

/** The refusal for an event longer than `max` characters. */
export function tooLong(max: number): RelaxUIError {
  return new RelaxUIError({
    code: "stream_malformed",
    message: `An event in the UI stream is longer than ${max} characters; the stream was refused.`,
  });
}

/**
 * Decodes a `text/event-stream` body into events.
 *
 * Written against `ReadableStream` rather than Node streams so the same code
 * path serves Node, Bun, Deno, Cloudflare Workers and the Vercel Edge runtime —
 * the environments a Next.js route handler can actually be deployed to.
 *
 * Stopping early cancels the body. A consumer that `break`s out of the loop, or
 * a generator further up that is `return()`ed, must close the HTTP response —
 * not merely stop reading it. Otherwise the server goes on generating, and
 * billing, for a reader that has gone; on a local runtime it also keeps the
 * model busy, so the next request queues behind an answer nobody wants.
 */
/** Characters read without an event before the decoder lets the event loop run. */
const YIELD_EVERY = 1024 * 1024;

export async function* decodeSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  options: DecodeSSEOptions = {},
): AsyncGenerator<SSEEvent, void, unknown> {
  const max = options.maxEventLength ?? DEFAULT_MAX_EVENT_LENGTH;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let scanFrom = 0;
  let drained = false;
  // Characters read since the last event or the last yield. A source that
  // hands over chunks without ever leaving the microtask queue (a stream built
  // in the page) would otherwise hold the main thread for a whole large body.
  let sinceYield = 0;

  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      if (signal?.aborted) {
        throw new RelaxUIError({ code: "aborted", message: "Stream aborted by caller." });
      }
      const { done, value } = await reader.read();
      if (done) {
        drained = true;
        break;
      }
      const text = decoder.decode(value, { stream: true });
      buffer += text;
      sinceYield += text.length;

      // Events are separated by a blank line; tolerate CRLF and bare LF. The
      // search resumes where the last one stopped, so a long event costs its
      // length once, not once per chunk.
      let boundary = findBoundary(buffer, scanFrom);
      while (boundary !== null) {
        if (boundary.index > max) throw tooLong(max);
        const raw = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const event = parseEventBlock(raw);
        sinceYield = 0;
        if (event) yield event;
        boundary = findBoundary(buffer, 0);
      }
      if (buffer.length > max) throw tooLong(max);
      if (sinceYield >= YIELD_EVERY) {
        sinceYield = 0;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      // A boundary may straddle two chunks: look again from its first character.
      scanFrom = Math.max(0, buffer.length - 3);
    }

    buffer += decoder.decode();
    const tail = parseEventBlock(buffer);
    if (tail) yield tail;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // Reached with the body still open whenever the consumer left early or an
    // error was thrown mid-stream. Releasing the lock alone would leave the
    // connection, and the generation behind it, running.
    if (!drained) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function findBoundary(buffer: string, from: number): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n", from);
  const crlf = buffer.indexOf("\r\n\r\n", from);
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
