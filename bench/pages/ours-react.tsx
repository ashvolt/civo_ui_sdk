/**
 * This SDK's React path: `useGenerativeObject` reading the same SSE byte
 * stream, validated in full against the bench contract's document schema, and
 * the renderer drawing the base theme.
 */
import { useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { baseComponents, createGenerativeRenderer, GenerativeTheme, useGenerativeObject } from "relax-ui-react";
import { installHarness, type Mounted } from "../src/probe/page.ts";
import { referenceMarkup } from "../src/probe/reference.ts";
import { benchContract } from "../src/workloads/contract.ts";

const Renderer = createGenerativeRenderer(benchContract as never, baseComponents as never);

interface Props {
  stream: ReadableStream<Uint8Array>;
  onDone: () => void;
  onError: (e: Error) => void;
}

function App({ stream, onDone, onError }: Props) {
  const source = useMemo(() => ({ stream }), [stream]);
  const { object, value, error, submit } = useGenerativeObject<{ root: never }>({
    source,
    schema: benchContract.documentSchema as never,
  });
  // The hook reads its source when asked to, as an application's submit would.
  useEffect(() => {
    void submit();
  }, [submit, source]);
  useEffect(() => {
    if (value) onDone();
  }, [value, onDone]);
  useEffect(() => {
    if (error) onError(new Error(`${error.code}: ${error.message}`));
  }, [error, onError]);
  return (
    <GenerativeTheme>
      <div id="react-root">
        <Renderer node={object?.root} />
      </div>
    </GenerativeTheme>
  );
}

/** Renders the app with a fresh stream into an existing root. */
function feed(root: Root, host: HTMLElement): Mounted {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const completed = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  flushSync(() => root.render(<App stream={stream} onDone={resolve} onError={reject} />));
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
    done: () => completed,
    root: () => host.querySelector("#react-root")?.firstElementChild ?? null,
    unmount: () => root.unmount(),
    next: async () => feed(root, host),
  };
}

installHarness({
  id: "ours-react",
  reference: referenceMarkup,
  async mount(host) {
    return feed(createRoot(host), host);
  },
});
