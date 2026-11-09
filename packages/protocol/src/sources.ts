import { RelaxUIError } from "./errors.js";
import { isUIStreamEvent, type UIStreamEvent } from "./events.js";
import { readUIStream } from "./read.js";
import type { JsonValue } from "./types.js";

/**
 * Where a document comes from. Exactly one key.
 *
 * Every kind ends up as the same thing — protocol 1 events, folded by the one
 * `UIStreamAccumulator` — so a renderer has one code path whatever the
 * transport (FR-205, data model S3).
 */
export type Source<T = unknown> =
  /** A complete document, already in hand. */
  | { document: T }
  /** An http(s) URL that answers a POST with the SDK's SSE stream. */
  | { url: string }
  /** Any byte stream in SSE framing: a `fetch` body, a worker, a file. */
  | { stream: ReadableStream<Uint8Array> }
  /** A WebSocket carrying one SDK event per message. Never closed by the reader. */
  | { socket: SocketLike };

export type SourceKind = "document" | "url" | "stream" | "socket";

/**
 * The part of `WebSocket` the reader uses. Deliberately has no `close`: the
 * socket belongs to the host and may carry other traffic (S2).
 */
export interface SocketLike {
  readonly readyState: number;
  addEventListener(type: "message" | "close" | "error", listener: (event: { data?: unknown }) => void): void;
  removeEventListener(type: "message" | "close" | "error", listener: (event: { data?: unknown }) => void): void;
}

export interface ReadSourceOptions {
  signal?: AbortSignal;
  /** POST body for a `url` source, sent as JSON. */
  body?: unknown;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  /** For tests and unusual runtimes; the global `fetch` otherwise. */
  fetch?: typeof fetch;
}

const KINDS: readonly SourceKind[] = ["document", "url", "stream", "socket"];

/** Names the kind of `source`, or refuses one that is not exactly one valid kind. */
export function sourceKind(source: Source): SourceKind {
  if (typeof source !== "object" || source === null) throw invalid("a source must be an object");
  const present = KINDS.filter((kind) => kind in source);
  if (present.length !== 1) {
    throw invalid(`a source must have exactly one of ${KINDS.join(", ")}; got ${present.join(", ") || "none"}`);
  }
  const kind = present[0]!;
  const value = (source as Record<string, unknown>)[kind];
  switch (kind) {
    case "url":
      if (typeof value !== "string" || value === "") throw invalid("`url` must be a non-empty string");
      break;
    case "stream":
      if (!(typeof value === "object" && value !== null && typeof (value as ReadableStream).getReader === "function")) {
        throw invalid("`stream` must be a ReadableStream");
      }
      break;
    case "socket":
      if (!isSocketLike(value)) throw invalid("`socket` must be a WebSocket");
      break;
    case "document":
      break;
  }
  return kind;
}

/**
 * Reads any source as protocol 1 events.
 *
 * How each kind ends:
 * - `document`: one `snapshot`, then the source is exhausted. The document is
 *   complete by definition; there is no generation metadata to report.
 * - `url`: as the SDK's route has always been read — until the stream closes.
 * - `stream`, `socket`: at `complete`, `error` or `[DONE]`. Ending any other way
 *   throws `truncated`, because a half-received document is not one the
 *   application chose to show.
 */
export async function* readSource<T = unknown>(
  source: Source<T>,
  options: ReadSourceOptions = {},
): AsyncGenerator<UIStreamEvent<T>, void, unknown> {
  const kind = sourceKind(source as Source);
  switch (kind) {
    case "document":
      yield { type: "snapshot", seq: 1, value: copyJson((source as { document: unknown }).document) };
      return;
    case "url":
      yield* readUrl<T>((source as { url: string }).url, options);
      return;
    case "stream":
      yield* untilTerminal(readUIStream<T>((source as { stream: ReadableStream<Uint8Array> }).stream, options.signal));
      return;
    case "socket":
      yield* readSocket<T>((source as { socket: SocketLike }).socket, options.signal);
      return;
  }
}

async function* readUrl<T>(url: string, options: ReadSourceOptions): AsyncGenerator<UIStreamEvent<T>> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...(options.credentials ? { credentials: options.credentials } : {}),
    body: JSON.stringify(options.body),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok || !response.body) {
    throw new RelaxUIError({
      code: "http_error",
      message: `Generative UI endpoint returned ${response.status} ${response.statusText}.`,
      status: response.status,
      retryable: response.status >= 500,
    });
  }
  yield* readUIStream<T>(response.body, options.signal);
}

/** Passes events through, and insists the stream says it is finished. */
async function* untilTerminal<T>(events: AsyncGenerator<UIStreamEvent<T>>): AsyncGenerator<UIStreamEvent<T>> {
  for await (const event of events) {
    yield event;
    // Returning closes `events`, which cancels the underlying body.
    if (event.type === "complete" || event.type === "error") return;
  }
  throw truncated("the stream ended before the document was complete");
}

const CLOSING = 2;

async function* readSocket<T>(socket: SocketLike, signal?: AbortSignal): AsyncGenerator<UIStreamEvent<T>> {
  // Messages are queued as they arrive and decoded in order. A Blob decodes
  // asynchronously; processing strictly from the queue keeps arrival order.
  const queue: unknown[] = [];
  let closed = socket.readyState >= CLOSING;
  let failed = false;
  let wake: (() => void) | undefined;
  const notify = () => wake?.();

  const onMessage = (event: { data?: unknown }) => {
    queue.push(event.data);
    notify();
  };
  const onClose = () => {
    closed = true;
    notify();
  };
  const onError = () => {
    failed = true;
    notify();
  };

  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", onClose);
  socket.addEventListener("error", onError);
  signal?.addEventListener("abort", notify, { once: true });

  try {
    for (;;) {
      if (signal?.aborted) throw new RelaxUIError({ code: "aborted", message: "Stream aborted by caller." });

      if (queue.length > 0) {
        const text = await messageText(queue.shift());
        if (text === undefined) continue;
        const data = text.trim();
        if (data === "[DONE]") return;
        if (data === "") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue; // same tolerance as the SSE reader: not ours, not fatal
        }
        if (!isUIStreamEvent(parsed)) continue;
        yield parsed as UIStreamEvent<T>;
        if (parsed.type === "complete" || parsed.type === "error") return;
        continue;
      }

      if (failed) {
        throw new RelaxUIError({ code: "transport_error", message: "The WebSocket reported an error.", retryable: true });
      }
      if (closed) throw truncated("the WebSocket closed before the document was complete");

      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
  } finally {
    // Stop listening; never close. The host owns the socket (S2).
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("close", onClose);
    socket.removeEventListener("error", onError);
    signal?.removeEventListener("abort", notify);
  }
}

async function messageText(data: unknown): Promise<string | undefined> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  if (typeof data === "object" && data !== null && typeof (data as Blob).text === "function") {
    return (data as Blob).text();
  }
  return undefined;
}

function isSocketLike(value: unknown): value is SocketLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SocketLike).readyState === "number" &&
    typeof (value as SocketLike).addEventListener === "function" &&
    typeof (value as SocketLike).removeEventListener === "function"
  );
}

/**
 * Copies a document, refusing anything JSON cannot carry.
 *
 * A copy, so the host mutating its object afterwards cannot change what was
 * rendered or validated. A refusal rather than `JSON.stringify`'s silent
 * coercion, because a `Date` becoming a string or a function vanishing would
 * render something the host never wrote. Iterative: the document may be
 * foreign, and a recursive walk is a stack overflow on a deep enough one.
 */
function copyJson(value: unknown): JsonValue {
  const seen = new Set<object>();
  const root: { value?: JsonValue } = {};
  const stack: Array<{ from: unknown; into: Record<string, JsonValue> | JsonValue[]; key: string | number }> = [
    { from: value, into: root as Record<string, JsonValue>, key: "value" },
  ];

  while (stack.length > 0) {
    const { from, into, key } = stack.pop()!;
    let copy: JsonValue;
    if (from === null || typeof from === "string" || typeof from === "boolean") {
      copy = from;
    } else if (typeof from === "number") {
      if (!Number.isFinite(from)) throw invalid("a document may not contain NaN or Infinity");
      copy = from;
    } else if (Array.isArray(from)) {
      if (seen.has(from)) throw invalid("a document may not contain a cycle");
      seen.add(from);
      const array: JsonValue[] = new Array(from.length);
      from.forEach((item, index) => stack.push({ from: item, into: array, key: index }));
      copy = array;
    } else if ((typeof from === "object" && Object.getPrototypeOf(from) === Object.prototype) || isNullProto(from)) {
      const object = from as Record<string, unknown>;
      if (seen.has(object)) throw invalid("a document may not contain a cycle");
      seen.add(object);
      const out: Record<string, JsonValue> = {};
      for (const k of Object.keys(object)) stack.push({ from: object[k], into: out, key: k });
      copy = out;
    } else {
      const what = typeof from === "object" ? (from as object).constructor?.name ?? "object" : typeof from;
      throw invalid(`a document must be plain JSON; found ${what}`);
    }
    (into as Record<string | number, JsonValue>)[key] = copy;
  }
  return root.value as JsonValue;
}

function isNullProto(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === null;
}

function invalid(message: string): RelaxUIError {
  return new RelaxUIError({ code: "config_invalid", message: `Invalid source: ${message}.` });
}

function truncated(message: string): RelaxUIError {
  return new RelaxUIError({ code: "truncated", message: `Incomplete document: ${message}.`, retryable: true });
}
