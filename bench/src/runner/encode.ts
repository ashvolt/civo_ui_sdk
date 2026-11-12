import { diffJson, encodeUIStreamEvent, type UIStreamEvent } from "relax-ui-protocol";
import type { Document } from "../workloads/generator.ts";

/**
 * This SDK's wire format for a step: protocol 1 SSE events, as its route sends
 * them. A `meta` frame, one `patch` per logical frame (data model §2), and
 * `complete` with the final document.
 *
 * One chunk per logical frame, as every contender's encoder gives: `meta`
 * travels with the first patch and `complete` with the last, as the route
 * sends them, back to back. Scheduled as chunks of their own, each cost this
 * SDK one delivery interval that no contender paid (50 ms on first node at
 * cold start).
 */
export function oursSSE(frames: readonly Document[]): string[] {
  const out: string[] = [];
  const meta =
    encodeUIStreamEvent({
      type: "meta",
      protocol: 1,
      requestId: "bench",
      model: "bench",
      provider: "bench",
      strategy: "json_schema",
      schema: {},
    } as unknown as UIStreamEvent);
  let previous: unknown;
  frames.forEach((frame, i) => {
    out.push(encodeUIStreamEvent({ type: "patch", seq: i + 1, ops: diffJson(previous as never, frame as never) } as UIStreamEvent));
    previous = frame;
  });
  const complete =
    encodeUIStreamEvent({
      type: "complete",
      value: frames.at(-1),
      metadata: { requestId: "bench", model: "bench", strategy: "json_schema", downgradedFrom: [], repairAttempts: 0, latencyMs: 0 },
    } as unknown as UIStreamEvent);
  out[0] = meta + out[0];
  out[out.length - 1] += complete;
  return out;
}
