import type { JsonPatchOp } from "./stream/json-patch.js";
import { applyPatch } from "./stream/json-patch.js";
import type { GenerationMetadata, JsonValue, StructuringStrategyName } from "./types.js";

/**
 * The server-to-browser wire protocol.
 *
 * This is the SDK's public contract at the network boundary, and the reason the
 * React layer needs no knowledge of relaxAI: the browser receives a typed event
 * stream describing *a validated object taking shape*, never raw model tokens.
 *
 * That boundary is the security design, not a convenience. Model output is
 * parsed, schema-checked and guarded on the server; what crosses to the client
 * has already been vouched for. A client that received raw tokens would have to
 * re-implement all of that in an environment where an attacker can edit it.
 *
 * Frames are SSE `data:` lines carrying one JSON object each, so the stream
 * survives proxies, works with `fetch` body streaming, and is legible in
 * devtools without a decoder.
 */
export const UI_STREAM_PROTOCOL_VERSION = 1 as const;

export type UIStreamEvent<T = unknown> =
  | UIStreamMetaEvent
  | UIStreamPatchEvent
  | UIStreamSnapshotEvent
  | UIStreamCompleteEvent<T>
  | UIStreamErrorEvent;

export interface UIStreamMetaEvent {
  type: "meta";
  protocol: typeof UI_STREAM_PROTOCOL_VERSION;
  requestId: string;
  model: string;
  /**
   * Id of the inference provider serving this generation. Added in an additive
   * revision of protocol 1, so a client MUST tolerate its absence.
   */
  provider?: string;
  schema: string;
  strategy: StructuringStrategyName;
}

/** Incremental update to the object built so far. `seq` is monotonic from 1. */
export interface UIStreamPatchEvent {
  type: "patch";
  seq: number;
  ops: JsonPatchOp[];
}

/**
 * A full replacement of the object. Sent when a diff would be larger than the
 * value itself, and after a repair round-trip rewrites the document.
 */
export interface UIStreamSnapshotEvent {
  type: "snapshot";
  seq: number;
  value: JsonValue;
}

/** Terminal success frame: `value` has passed the full schema. */
export interface UIStreamCompleteEvent<T = unknown> {
  type: "complete";
  value: T;
  metadata: GenerationMetadata;
}

/** Terminal failure frame. Deliberately carries no prompt or model text. */
export interface UIStreamErrorEvent {
  type: "error";
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId?: string;
    /**
     * Redacted schema issues: JSON pointer and Zod issue code, never a value.
     *
     * Without this the browser is told "the document violates the schema" and
     * nothing else, which is unactionable — the field that broke is the single
     * most useful fact, and `redactIssues` has already stripped everything that
     * could carry prompt or completion text.
     */
    details?: JsonValue;
  };
}

/** Serialises one event as an SSE frame. */
export function encodeUIStreamEvent(event: UIStreamEvent<unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function isUIStreamEvent(value: unknown): value is UIStreamEvent {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === "meta" || type === "patch" || type === "snapshot" || type === "complete" || type === "error";
}

/**
 * Folds a stream of events into the current object.
 *
 * Shared between the React hook and any non-React consumer so there is exactly
 * one implementation of "what does the document look like now" — a second one
 * would drift, and a client that disagrees with the server about the document
 * is a rendering bug nobody can reproduce.
 */
export class UIStreamAccumulator<T = unknown> {
  private value: JsonValue | undefined;
  private lastSeq = 0;
  private metaEvent?: UIStreamMetaEvent;
  private completed?: UIStreamCompleteEvent<T>;
  private failure?: UIStreamErrorEvent;

  apply(event: UIStreamEvent<T>): void {
    switch (event.type) {
      case "meta":
        this.metaEvent = event;
        return;
      case "patch":
        this.assertSeq(event.seq);
        this.value = applyPatch(this.value, event.ops);
        return;
      case "snapshot":
        this.assertSeq(event.seq);
        this.value = event.value;
        return;
      case "complete":
        this.completed = event;
        this.value = event.value as unknown as JsonValue;
        return;
      case "error":
        this.failure = event;
        return;
    }
  }

  private assertSeq(seq: number): void {
    // Out-of-order frames cannot be reconciled: a patch assumes the exact
    // document the server had. Better to say so than to render a mixture.
    if (seq !== this.lastSeq + 1) {
      throw new Error(`UI stream out of order: expected seq ${this.lastSeq + 1}, received ${seq}.`);
    }
    this.lastSeq = seq;
  }

  /** The object as of the last applied frame. Partial until `complete`. */
  current(): JsonValue | undefined {
    return this.value;
  }

  meta(): UIStreamMetaEvent | undefined {
    return this.metaEvent;
  }

  result(): UIStreamCompleteEvent<T> | undefined {
    return this.completed;
  }

  error(): UIStreamErrorEvent | undefined {
    return this.failure;
  }

  get done(): boolean {
    return this.completed !== undefined || this.failure !== undefined;
  }
}
