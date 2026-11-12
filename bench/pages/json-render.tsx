/**
 * json-render (T-431): its own streaming hook, `useUIStream`, reads JSONL
 * lines of RFC 6902 patches to a flat spec and re-renders `<Renderer>` per
 * line, through a registry whose components draw the kit.
 */
import { defineCatalog } from "@json-render/core";
import { defineRegistry, JSONUIProvider, Renderer, useUIStream } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { useEffect } from "react";
import { z } from "zod";
import { reactContender, type ViewProps } from "../src/adapters/react-contender.tsx";
import { allTemplates, drawReact } from "../src/kit/react.ts";
import { installHarness } from "../src/probe/page.ts";

const types = Object.keys(allTemplates);
const catalog = defineCatalog(schema, {
  components: Object.fromEntries(types.map((t) => [t, { props: z.looseObject({}), description: t }])),
  actions: {},
} as never);
const { registry } = defineRegistry(catalog as never, {
  components: Object.fromEntries(
    types.map((t) => [t, ({ props, children }: { props: Record<string, unknown>; children?: React.ReactNode }) => drawReact(t, props, children)]),
  ),
} as never);

// useUIStream fetches its endpoint; the page answers it with the scheduler's stream.
const API = "/__bench/json-render";
let respond: typeof fetch | undefined;
const pageFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  String(input).endsWith(API) && respond ? respond(input, init) : pageFetch(input, init)) as typeof fetch;

function View({ fetch, onDone, onError }: ViewProps) {
  const { spec, send } = useUIStream({ api: API, onComplete: () => onDone(), onError });
  useEffect(() => {
    respond = fetch;
    void send("");
  }, []);
  return (
    <JSONUIProvider registry={registry}>
      <Renderer spec={spec} registry={registry} />
    </JSONUIProvider>
  );
}

installHarness(reactContender("json-render", View));
