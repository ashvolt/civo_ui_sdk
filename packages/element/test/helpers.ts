import { diffJson, encodeUIStreamEvent, UI_STREAM_PROTOCOL_VERSION, type UIStreamEvent } from "relax-ui-protocol";
import { defineGenUI, type GenUIElement } from "relax-ui-element";
import { frames } from "../../render/test/fixtures.js";

export { canonical, DASHBOARD, frames, NESTED, REPORT } from "../../render/test/fixtures.js";

defineGenUI();

/** Places a `<gen-ui>` with `attrs`, after setting `props` on it. */
export function mount(attrs: Record<string, string> = {}, props: Partial<GenUIElement> = {}): GenUIElement {
  const el = document.createElement("gen-ui") as GenUIElement;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  Object.assign(el, props);
  document.body.appendChild(el);
  return el;
}

/** The element's rendered surface, whichever mode. */
export function surface(el: GenUIElement): HTMLElement {
  return (el.shadowRoot ?? el).querySelector(".gen-theme") as HTMLElement;
}

/** Waits until `check` holds, letting dynamic imports and streams settle. */
export async function until(check: () => boolean, what = "condition", ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}

export const META: UIStreamEvent = {
  type: "meta",
  protocol: UI_STREAM_PROTOCOL_VERSION,
  requestId: "req_1",
  model: "test-model",
  provider: "test-provider",
  strategy: "json_schema",
  schema: {},
} as unknown as UIStreamEvent;

export const METADATA = {
  requestId: "req_1",
  model: "test-model",
  provider: "test-provider",
  strategy: "json_schema",
  downgradedFrom: [],
  repairAttempts: 0,
  latencyMs: 1,
} as never;

/** The events a server sends while streaming `doc`: meta, patches, complete. */
export function events(doc: unknown, step = 7, complete = true): UIStreamEvent[] {
  const out: UIStreamEvent[] = [META];
  let previous: unknown;
  let seq = 0;
  for (const frame of frames(doc, step)) {
    out.push({ type: "patch", seq: ++seq, ops: diffJson(previous as never, frame) } as UIStreamEvent);
    previous = frame;
  }
  if (complete) out.push({ type: "complete", value: doc, metadata: METADATA } as UIStreamEvent);
  return out;
}

/** An SSE byte stream of `list`, one chunk per event. */
export function sse(list: UIStreamEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < list.length) controller.enqueue(encoder.encode(encodeUIStreamEvent(list[i++]!)));
      else controller.close();
    },
  });
}

/** A WebSocket stand-in the test drives; records whether anyone closed it. */
export function fakeSocket() {
  const listeners: Record<string, Set<(e: { data?: unknown }) => void>> = { message: new Set(), close: new Set(), error: new Set() };
  const socket = {
    readyState: 1,
    closedByReader: false,
    addEventListener: (type: string, f: (e: { data?: unknown }) => void) => listeners[type]!.add(f),
    removeEventListener: (type: string, f: (e: { data?: unknown }) => void) => listeners[type]!.delete(f),
    close() {
      socket.closedByReader = true;
    },
    send(event: UIStreamEvent) {
      for (const f of listeners.message!) f({ data: JSON.stringify(event) });
    },
    hangUp() {
      socket.readyState = 3;
      for (const f of listeners.close!) f({});
    },
    listening: () => listeners.message!.size > 0,
  };
  return socket;
}

/** Collects the element's events by type. */
export function record(el: GenUIElement) {
  const log: { type: string; detail: unknown }[] = [];
  for (const type of ["gen-ui:state", "gen-ui:frame", "gen-ui:complete", "gen-ui:error"]) {
    el.addEventListener(type, (e) => log.push({ type, detail: (e as CustomEvent).detail }));
  }
  return {
    log,
    of: (type: string) => log.filter((e) => e.type === type).map((e) => e.detail as Record<string, unknown>),
  };
}
