import { encodeUIStreamEvent, type UIStreamEvent } from "relax-ui-protocol";
import { seeded } from "../workloads/random.ts";
import type { AttackMount, AttackSetup } from "./page.ts";

/**
 * Protocol and denial-of-service abuse (T-442, contracts/attacks.md "Protocol
 * and denial of service", research R8). Each case builds its source in the
 * page (a stream or a socket the page controls), so a 100 MB frame never
 * crosses the test driver, and marks the moment the bad input arrived, so the
 * time to fail closed can be measured. What each case requires is in
 * `PROTOCOL_CASES`, checked by the runner.
 */

export interface ProtocolBuild {
  setup: AttackSetup;
  /** When the bad input arrived (`performance.now()`), set by the source. */
  marks: { bad?: number };
  /** Called once the renderer is mounted: the case's own action (stop, say). */
  during?(mount: AttackMount): Promise<void> | void;
}

export type Requirement =
  /** Refused with a stable code; nothing after the bad frame applied. */
  | "refused-intact"
  /** Ends with `truncated`. */
  | "truncated"
  /** Ignored or refused, the page responsive. */
  | "tolerated"
  /** Refused, or heap within budget; the page responsive. */
  | "bounded"
  /** `stop()` ends the read; the page responsive. */
  | "stoppable"
  /** Refused before anything renders. */
  | "refused-before-render"
  /** Bounded time against the same document with unique keys. */
  | "bounded-time"
  /** No prototype or global changed. */
  | "no-globals";

export interface ProtocolCase {
  id: string;
  requirement: Requirement;
  /** For `bounded-time`: the case whose time this one is compared with. */
  against?: string;
}

export const PROTOCOL_CASES: readonly ProtocolCase[] = [
  { id: "seq-missing", requirement: "refused-intact" },
  { id: "seq-duplicate", requirement: "refused-intact" },
  { id: "seq-out-of-order", requirement: "refused-intact" },
  { id: "truncated-stream", requirement: "truncated" },
  { id: "socket-closed", requirement: "truncated" },
  { id: "malformed-json", requirement: "tolerated" },
  { id: "sse-framing", requirement: "tolerated" },
  { id: "binary-garbage", requirement: "tolerated" },
  { id: "oversized-1mb", requirement: "bounded" },
  { id: "oversized-10mb", requirement: "bounded" },
  { id: "oversized-100mb", requirement: "bounded" },
  { id: "unterminated-10mb", requirement: "bounded" },
  { id: "slow-drip", requirement: "stoppable" },
  { id: "over-budget-nodes", requirement: "refused-before-render" },
  { id: "over-budget-depth", requirement: "refused-before-render" },
  { id: "keys-unique", requirement: "tolerated" },
  { id: "keys-colliding", requirement: "bounded-time", against: "keys-unique" },
  { id: "socket-flood", requirement: "bounded" },
  { id: "proto-paths", requirement: "no-globals" },
];

// --- Events -------------------------------------------------------------------

const ev = (e: unknown) => encodeUIStreamEvent(e as UIStreamEvent);
const META = ev({ type: "meta", protocol: 1, requestId: "attack", model: "attack", provider: "attack", strategy: "json_schema", schema: {} });
const patch = (seq: number, ops: unknown[]) => ev({ type: "patch", seq, ops });
const complete = (value: unknown) =>
  ev({ type: "complete", value, metadata: { requestId: "attack", model: "attack", strategy: "json_schema", downgradedFrom: [], repairAttempts: 0, latencyMs: 0 } });

const text = (key: string, t: string) => ({ type: "Text", key, props: { text: t, tone: "default" } });
const stackOf = (children: unknown[]) => ({ root: { type: "Stack", key: "p", props: { gap: "sm", direction: "column" }, children } });
const addChild = (i: number, node: unknown) => ({ op: "add", path: `/root/children/${i}`, value: node });

// --- Sources the page controls ---------------------------------------------------

type Step = { bytes: string | Uint8Array; bad?: boolean; wait?: number };

function streamOf(steps: readonly Step[], marks: ProtocolBuild["marks"], close = true): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      if (i >= steps.length) {
        if (close) c.close();
        return;
      }
      const s = steps[i++]!;
      if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
      if (s.bad && marks.bad === undefined) marks.bad = performance.now();
      c.enqueue(typeof s.bytes === "string" ? enc.encode(s.bytes) : s.bytes);
    },
  });
}

/** A string as 64 KB chunks, as a network delivers a large body. */
function chunked(s: string, bad = false): Step[] {
  const out: Step[] = [];
  for (let i = 0; i < s.length; i += 65_536) out.push({ bytes: s.slice(i, i + 65_536), ...(bad && i === 0 ? { bad } : {}) });
  return out;
}

/** A socket the page drives: what `{ socket }` reads. */
class FakeSocket extends EventTarget {
  readyState = 1;
  #heard!: () => void;
  /** Resolves when the reader has subscribed, so no message is sent to nobody. */
  readonly listening = new Promise<void>((r) => (this.#heard = r));
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    super.addEventListener(type, listener, options);
    if (type === "message") this.#heard();
  }
  send(data: string) {
    this.dispatchEvent(Object.assign(new Event("message"), { data }));
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

const full = (source: object, contract: AttackSetup["contract"] = "bench"): AttackSetup => ({ source, validate: "full", contract });

function nested(depth: number) {
  let node: unknown = text("deepest", "DEEPEST");
  for (let d = depth - 1; d >= 1; d--) node = { type: "Card", key: `d${d}`, props: { title: `level ${d}` }, children: [node] };
  return { root: node };
}

export function buildProtocolCase(id: string): ProtocolBuild {
  const marks: ProtocolBuild["marks"] = {};
  const s = (steps: Step[], close = true) => full({ stream: streamOf(steps, marks, close) });
  const before = stackOf([text("t0", "BEFORE")]);
  const after = addChild(1, text("t1", "AFTER"));
  const mid = addChild(1, text("tm", "MID"));
  switch (id) {
    case "seq-missing":
      return { marks, setup: s([{ bytes: META + patch(1, [{ op: "add", path: "", value: before }]) }, { bytes: patch(3, [after]), bad: true }, { bytes: complete(before) }]) };
    case "seq-duplicate":
      return {
        marks,
        setup: s([{ bytes: META + patch(1, [{ op: "add", path: "", value: before }]) }, { bytes: patch(2, [mid]) }, { bytes: patch(2, [addChild(2, text("t1", "AFTER"))]), bad: true }, { bytes: complete(before) }]),
      };
    case "seq-out-of-order":
      return { marks, setup: s([{ bytes: META + patch(1, [{ op: "add", path: "", value: before }]) }, { bytes: patch(3, [after]), bad: true }, { bytes: patch(2, [mid]) }]) };
    case "truncated-stream":
      return { marks, setup: s([{ bytes: META + patch(1, [{ op: "add", path: "", value: before }]) }, { bytes: "", bad: true }]) };
    case "socket-closed": {
      const socket = new FakeSocket();
      return {
        marks,
        setup: full({ socket }),
        during: async () => {
          await socket.listening;
          socket.send(META.replace(/^data: /, "").trim());
          socket.send(patch(1, [{ op: "add", path: "", value: before }]).replace(/^data: /, "").trim());
          await new Promise((r) => setTimeout(r, 50));
          marks.bad = performance.now();
          socket.close();
        },
      };
    }
    case "malformed-json":
      return { marks, setup: s([{ bytes: META }, { bytes: "data: {oops, not json\n\n", bad: true }, { bytes: patch(1, [{ op: "add", path: "", value: before }]) }, { bytes: complete(before) }]) };
    case "sse-framing":
      return {
        marks,
        setup: s([
          { bytes: META },
          { bytes: ": a comment\nretry: soon\nnot a field\nevent: patch\r\ndata:\r\n\r\n", bad: true },
          // Two data lines, joined by the reader into an event that is not the SDK's.
          { bytes: "id: \u0000\ndata: {\"type\":\ndata: \"noise\"}\n\n" },
          { bytes: patch(1, [{ op: "add", path: "", value: before }]).replace(/\n/g, "\r") },
          { bytes: "\r\r" + complete(before) },
        ]),
      };
    case "binary-garbage": {
      const r = seeded(1);
      const junk = Uint8Array.from({ length: 262_144 }, () => r.int(0, 255));
      return { marks, setup: s([{ bytes: META }, { bytes: junk, bad: true }, { bytes: "\n\n" + patch(1, [{ op: "add", path: "", value: before }]) }, { bytes: complete(before) }]) };
    }
    case "oversized-1mb":
    case "oversized-10mb":
    case "oversized-100mb": {
      const mb = Number(id.match(/(\d+)mb/)![1]);
      const big = patch(1, [{ op: "add", path: "", value: stackOf([text("big", "x".repeat(mb * 1_048_576))]) }]);
      return { marks, setup: s([{ bytes: META }, ...chunked(big, true), { bytes: complete(before) }]) };
    }
    case "unterminated-10mb":
      return { marks, setup: s([{ bytes: META }, ...chunked("data: " + "x".repeat(10 * 1_048_576), true)]) };
    case "slow-drip": {
      const body = META + patch(1, [{ op: "add", path: "", value: before }]) + complete(before);
      // One byte every 20 ms: the whole document would take minutes.
      const steps: Step[] = [...body].map((ch, i) => ({ bytes: ch, wait: 20, ...(i === 0 ? { bad: true } : {}) }));
      return {
        marks,
        setup: s(steps),
        during: async (mount) => {
          await new Promise((r) => setTimeout(r, 3_000));
          marks.bad = performance.now();
          mount.stop?.();
        },
      };
    }
    case "over-budget-nodes": {
      const doc = stackOf(Array.from({ length: 600 }, (_, i) => text(`n${i}`, `node-${i}`)));
      return { marks, setup: full({ stream: streamOf([{ bytes: META + patch(1, [{ op: "add", path: "", value: doc }]), bad: true }, { bytes: complete(doc) }], marks) }, "standard") };
    }
    case "over-budget-depth": {
      const doc = nested(40);
      return { marks, setup: full({ stream: streamOf([{ bytes: META + patch(1, [{ op: "add", path: "", value: doc }]), bad: true }, { bytes: complete(doc) }], marks) }, "standard") };
    }
    case "keys-unique":
    case "keys-colliding": {
      const same = id === "keys-colliding";
      const doc = stackOf(Array.from({ length: 10_000 }, (_, i) => text(same ? "k" : `k${i}`, `item ${i}`)));
      return { marks, setup: s([{ bytes: META + patch(1, [{ op: "add", path: "", value: doc }]), bad: true }, { bytes: complete(doc) }]) };
    }
    case "socket-flood": {
      const socket = new FakeSocket();
      return {
        marks,
        setup: full({ socket }),
        during: async () => {
          await socket.listening;
          socket.send(META.replace(/^data: /, "").trim());
          marks.bad = performance.now();
          // 10,000 messages a second for two seconds, as fast as timers allow.
          const noise = JSON.stringify({ type: "noise", pad: "x".repeat(1_000) });
          for (let tick = 0; tick < 200; tick++) {
            for (let k = 0; k < 100; k++) socket.send(noise);
            await new Promise((r) => setTimeout(r, 10));
          }
          socket.send(patch(1, [{ op: "add", path: "", value: before }]).replace(/^data: /, "").trim());
          socket.send(complete(before).replace(/^data: /, "").trim());
        },
      };
    }
    case "proto-paths": {
      const ops = [
        { op: "add", path: "", value: before },
        { op: "add", path: "/__proto__/polluted", value: "pwn" },
        { op: "add", path: "/root/__proto__/relaxPolluted", value: "pwn" },
        { op: "add", path: "/root/props/__proto__/polluted", value: "pwn" },
        { op: "add", path: "/constructor/prototype/polluted", value: "pwn" },
        { op: "replace", path: "/root/constructor/prototype/relaxPolluted", value: "pwn" },
      ];
      return { marks, setup: s([{ bytes: META + ops.map((o, i) => patch(i + 1, [o])).join(""), bad: true }, { bytes: complete(before) }]) };
    }
  }
  throw new Error(`unknown protocol case ${id}`);
}
