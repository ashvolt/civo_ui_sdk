import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { themeAttributes } from "relax-ui-theme-base";
import { installKitCss } from "../kit/css.ts";
import type { Mounted, PageAdapter } from "../probe/page.ts";
import { referenceMarkup } from "../probe/reference.ts";
import { componentRoot } from "./contender-root.ts";

export { componentRoot };

/**
 * A page for a React contender (T-431, T-433, T-434). Every contender reads
 * the same thing this SDK's element reads: a byte stream, fed by the page's
 * scheduler, through the contender's own entry point (its fetch hook, its
 * stream reader). The view calls `onDone` when the contender says the
 * response is complete; the page then waits two frames for the last commit.
 */

export interface ViewProps {
  stream: ReadableStream<Uint8Array>;
  /** A `fetch` that answers any request with `stream`, for hooks that fetch. */
  fetch: typeof fetch;
  onDone: () => void;
  onError: (e: Error) => void;
}

export type ContenderView = (props: ViewProps) => ReactElement | null;

let documents = 0;

function feed(root: Root, host: HTMLElement, View: ContenderView): Mounted {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const respond = (() => Promise.resolve(new Response(stream, { headers: { "content-type": "text/plain" } }))) as typeof fetch;
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const completed = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const attrs = themeAttributes("light", "comfortable");
  // Each document is a new response: keyed, as an app keys its messages.
  root.render(
    <div className={attrs.class} data-gen-variant={attrs["data-gen-variant"]} data-gen-density={attrs["data-gen-density"]}>
      <View key={documents++} stream={stream} fetch={respond} onDone={resolve} onError={reject} />
    </div>,
  );
  return {
    push(chunk) {
      try {
        controller.enqueue(encoder.encode(chunk));
      } catch {
        // the contender stopped reading; done() reports why
      }
    },
    end() {
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
    async done() {
      await completed;
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    },
    root: () => componentRoot(host),
    unmount: () => root.unmount(),
    next: async () => feed(root, host, View),
  };
}

export function reactContender(id: string, view: ContenderView, extra: Pick<PageAdapter, "unwrap"> = {}): PageAdapter {
  installKitCss();
  return {
    ...extra,
    id,
    reference: referenceMarkup,
    async mount(host) {
      return feed(createRoot(host), host, view);
    },
  };
}

/** Reads a byte stream as text, calling `onText` with everything so far after each chunk. */
export async function readText(stream: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
}
