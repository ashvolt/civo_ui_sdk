/**
 * This SDK's React path: `useGenerativeObject` reading the same SSE byte
 * stream, validated in full against the bench contract's document schema, and
 * the renderer drawing the base theme.
 */
import { useEffect, useMemo, useRef } from "react";
import { standardContract } from "relax-ui-contract";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { baseComponents, createGenerativeRenderer, fromTemplates, GenerativeTheme, useGenerativeObject } from "relax-ui-react";
import { installKitCss, kitTemplates } from "../src/kit/index.ts";
import type { AttackSetup, Settled } from "../src/attacks/page.ts";
import { installHarness, type Mounted } from "../src/probe/page.ts";
import { referenceMarkup } from "../src/probe/reference.ts";
import { benchContract } from "../src/workloads/contract.ts";

const Renderer = createGenerativeRenderer(benchContract as never, { ...baseComponents, ...fromTemplates(kitTemplates as unknown as Parameters<typeof fromTemplates>[0]) } as never);
/** The standard contract and its budgets, for the attack cases that test them. */
const StandardRenderer = createGenerativeRenderer(standardContract as never, baseComponents as never);
installKitCss();

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

/**
 * One attack case: the hook reads the case's source at its tier, against the
 * case's contract; refusals are counted as they render. `control.stop` is the
 * host's stop button.
 */
function AttackApp({ setup, onSettled, control }: { setup: AttackSetup; onSettled: (s: Settled) => void; control: { stop?: () => void } }) {
  const refused = useMemo(() => new Set<string>(), []);
  const standard = setup.contract === "standard";
  const stopped = useRef(false);
  const { object, value, error, isStreaming, submit, stop } = useGenerativeObject<{ root: never }>({
    source: setup.source as never,
    validate: setup.validate,
    schema: (standard ? standardContract : benchContract).documentSchema as never,
  });
  control.stop = () => {
    stopped.current = true;
    stop();
  };
  useEffect(() => {
    void submit();
  }, [submit]);
  useEffect(() => {
    const done = value || error || (stopped.current && !isStreaming);
    if (!done) return;
    const status = error ? "error" : value ? "complete" : "stopped";
    // After the commit that drew the final value, so its refusals are counted.
    requestAnimationFrame(() => onSettled({ status, refused: refused.size, ...(error ? { errorCode: error.code } : {}) }));
  }, [value, error, isStreaming, onSettled, refused]);
  const Draw = standard ? StandardRenderer : Renderer;
  return (
    <GenerativeTheme>
      <div id="react-root">
        <Draw
          node={object?.root}
          onInvalidNode={(f) => {
            refused.add(`${f.reason}:${f.type}:${f.detail ?? ""}`);
            return null;
          }}
        />
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
  async attack(host, setup) {
    const root = createRoot(host);
    const control: { stop?: () => void } = {};
    const settled = new Promise<Settled>((resolve) => flushSync(() => root.render(<AttackApp setup={setup} onSettled={resolve} control={control} />)));
    return { settled: () => settled, surface: () => host, stop: () => control.stop?.(), unmount: () => root.unmount() };
  },
});
