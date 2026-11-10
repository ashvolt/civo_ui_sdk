/**
 * This SDK's Web Component, as a host would use it: `<gen-ui>` in its default
 * shadow mode, lazy base theme, fed a protocol 1 SSE byte stream, validated in
 * full against the bench contract (the strictest setting; adapter contract).
 */
import { defineGenUI, type GenUIElement } from "relax-ui-element";
import { type Mounted, type PageAdapter } from "../probe/page.ts";
import { referenceMarkup } from "../probe/reference.ts";
import { benchContract } from "../workloads/contract.ts";

defineGenUI();

/** Feeds one document's SSE bytes into an element that is already on the page. */
function feed(el: GenUIElement): Mounted {
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
  el.source = { stream };
  const surface = () => el.shadowRoot?.querySelector(".gen-theme") ?? null;
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
    next: async () => feed(el),
  };
}

export function elementAdapter(id = "ours-element"): PageAdapter {
  return {
    id,
    reference: referenceMarkup,
    async mount(host) {
      const el = document.createElement("gen-ui") as GenUIElement;
      el.contract = benchContract as never;
      host.replaceChildren(el);
      return feed(el);
    },
  };
}
