/**
 * A2UI's React renderer (T-432): v0.9 messages, one per line, read from the
 * stream into a `MessageProcessor`; `A2uiSurface` draws the surface with a
 * catalog of kit components made by `createComponentImplementation`. A2UI
 * wraps each component in a host element of its own (`<a2ui-react-card>`);
 * the comparison reads through those.
 */
import { A2uiSurface, createComponentImplementation } from "@a2ui/react/v0_9";
import { Catalog, MessageProcessor, type SurfaceModel } from "@a2ui/web_core/v0_9";
import { useEffect, useState } from "react";
import { reactContender, readText, type ViewProps } from "../src/adapters/react-contender.tsx";
import { kitApis, kitProps } from "../src/kit/a2ui.ts";
import { drawReact } from "../src/kit/react.ts";
import { installHarness } from "../src/probe/page.ts";
import { A2UI_CATALOG } from "../src/runner/contenders.ts";

const catalog = new Catalog(
  A2UI_CATALOG,
  "v0.9",
  kitApis.map((api) =>
    createComponentImplementation(api as never, ({ props, buildChild }) => {
      const children = (props as { children?: string[] }).children?.map((id) => buildChild(id));
      return drawReact(api.name, kitProps(props as Record<string, unknown>), children);
    }),
  ) as never,
);

/** Calls `onLine` with each complete line of the stream, as it arrives. */
async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  let used = 0;
  await readText(stream, (text) => {
    for (let end = text.indexOf("\n", used); end !== -1; end = text.indexOf("\n", used)) {
      const line = text.slice(used, end);
      used = end + 1;
      if (line) onLine(line);
    }
  });
}

function View({ stream, onDone, onError }: ViewProps) {
  const [processor] = useState(() => new MessageProcessor([catalog as never]));
  const [surface, setSurface] = useState<SurfaceModel<never>>();
  useEffect(() => {
    const sub = processor.onSurfaceCreated((s) => setSurface(s as never));
    readLines(stream, (line) => processor.processMessages(JSON.parse(line))).then(onDone, onError);
    return () => sub.unsubscribe();
  }, []);
  return surface ? <A2uiSurface surface={surface} /> : null;
}

installHarness(reactContender("a2ui-react", View, { unwrap: (el) => el.localName.startsWith("a2ui-") }));
