/**
 * This SDK's Web Component, as a host would use it: `<gen-ui>` in its default
 * shadow mode, lazy base theme, fed a protocol 1 SSE byte stream, validated in
 * full against the bench contract (the strictest setting; adapter contract).
 */
import { standardContract } from "relax-ui-contract";
import { defineGenUI, type Connector, type GenUIElement, type RenderState } from "relax-ui-element";
import type { AttackMount, AttackSetup, Settled } from "../attacks/page.ts";
import { type Mounted, type PageAdapter } from "../probe/page.ts";
import { kitConnector } from "../kit/index.ts";
import { referenceMarkup } from "../probe/reference.ts";
import { benchContract } from "../workloads/contract.ts";

defineGenUI();

/**
 * Feeds one document's SSE bytes into an element that is already on the page.
 * `setSource` is how the page hands the element its source: directly, or
 * through a framework's state when the element sits in a framework's template
 * (`ours-vue-host`, `ours-angular-host`).
 */
export function feedElement(el: GenUIElement, setSource: (source: { stream: ReadableStream<Uint8Array> }) => void = (s) => void (el.source = s)): Mounted {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const completed = new Promise<void>((resolve, reject) => {
    const ok = () => {
      el.removeEventListener("gen-ui:error", fail);
      resolve();
    };
    const fail = (e: Event) => {
      el.removeEventListener("gen-ui:complete", ok);
      const d = (e as CustomEvent<{ code: string; message: string }>).detail;
      reject(new Error(`${d.code}: ${d.message}`));
    };
    el.addEventListener("gen-ui:complete", ok, { once: true });
    el.addEventListener("gen-ui:error", fail, { once: true });
  });
  setSource({ stream });
  const surface = () => (el.shadowRoot ?? el).querySelector(".gen-theme");
  return {
    push: (chunk) => {
      // A renderer that stopped reading has already reported why, through
      // `done()`; pushing into its closed stream is not the failure.
      try {
        controller.enqueue(encoder.encode(chunk));
      } catch {
        // reported by done()
      }
    },
    end: () => {
      // The reader cancels the stream itself once it has read `complete`.
      try {
        controller.close();
      } catch {
        // already closed by the reader
      }
    },
    async done() {
      await completed;
      // Lazily loaded component code may still be arriving.
      while (surface()?.querySelector("[aria-busy]")) await new Promise((r) => requestAnimationFrame(r));
    },
    root: () => surface()?.firstElementChild ?? null,
    unmount: () => el.remove(),
    next: async () => feedElement(el, setSource),
  };
}

/**
 * One attack case through an element already on the page (T-441): the tier
 * as an attribute, then the source, set the host's way. Settled when the
 * element reports `complete` or `error` and no component code is loading.
 */
export function attackElement(el: GenUIElement, setSource: (source: object) => void, setup: AttackSetup): AttackMount {
  if (setup.contract === "standard") el.contract = standardContract as never;
  el.setAttribute("validate", setup.validate);
  let streamed = false;
  const settled = new Promise<Settled>((resolve) => {
    const on = (e: Event) => {
      const s = (e as CustomEvent<RenderState>).detail;
      if (s.status === "streaming") streamed = true;
      // Idle after streaming: stopped by the host.
      const done = s.status === "complete" || s.status === "error" || (s.status === "idle" && streamed);
      if (!done) return;
      el.removeEventListener("gen-ui:state", on);
      resolve({ status: s.status === "idle" ? "stopped" : s.status, refused: s.refused.length, ...(s.error ? { errorCode: s.error.code } : {}) });
    };
    el.addEventListener("gen-ui:state", on);
  });
  setSource(setup.source);
  // A URL is read when the host submits, as an application's form would; the
  // host's framework may hand the element its source on its next update.
  if ("url" in setup.source) {
    void (async () => {
      while ((el.source as { url?: string } | undefined)?.url !== (setup.source as { url: string }).url) await new Promise((r) => setTimeout(r, 0));
      void el.submit();
    })();
  }
  const surface = () => el.shadowRoot ?? el;
  return {
    async settled() {
      const s = await settled;
      while (surface().querySelector("[aria-busy]")) await new Promise((r) => requestAnimationFrame(r));
      // Refusals reported after `complete` (lazily loaded code) are counted too.
      return { ...s, refused: el.state.refused.length };
    },
    surface,
    stop: () => el.stop(),
    unmount: () => el.remove(),
  };
}

export interface ElementOptions {
  /** `light` for a framework connector, whose library styles are global. */
  mode?: "shadow" | "light";
  /** Connectors after the kit's. */
  connectors?: readonly Connector[];
}

export function elementAdapter(id = "ours-element", options: ElementOptions = {}): PageAdapter {
  return {
    id,
    reference: referenceMarkup,
    async mount(host) {
      const el = document.createElement("gen-ui") as GenUIElement;
      if (options.mode === "light") el.setAttribute("mode", "light");
      el.contract = benchContract as never;
      // The heavy visuals, as any host adds its own components.
      el.connectors = [kitConnector(), ...(options.connectors ?? [])];
      host.replaceChildren(el);
      return feedElement(el);
    },
    async attack(host, setup) {
      const el = document.createElement("gen-ui") as GenUIElement;
      if (options.mode === "light") el.setAttribute("mode", "light");
      el.contract = benchContract as never;
      el.connectors = [kitConnector(), ...(options.connectors ?? [])];
      host.replaceChildren(el);
      return attackElement(el, (s) => void (el.source = s as never), setup);
    },
  };
}
