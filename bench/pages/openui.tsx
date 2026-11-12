/**
 * OpenUI Lang (T-433): the response text grows as the stream arrives, and
 * `<Renderer response isStreaming>` parses and renders it, through a library
 * whose components draw the kit.
 */
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { useEffect, useState } from "react";
import { z } from "zod/v4";
import { readText, reactContender, type ViewProps } from "../src/adapters/react-contender.tsx";
import { allTemplates, drawReact } from "../src/kit/react.ts";
import { installHarness } from "../src/probe/page.ts";
import { propOrder } from "../src/runner/contenders.ts";

const components = Object.keys(allTemplates).map((name) => {
  const props: Record<string, z.ZodType> = {};
  // Positional arguments in the order the encoder writes them; all optional,
  // so a half-written statement still draws (as every renderer here does).
  for (const p of propOrder(name)) props[p] = p === "children" ? z.array(z.any()).optional() : z.any().optional();
  return defineComponent({
    name,
    description: name,
    props: z.object(props),
    component: ({ props: p, renderNode }) => drawReact(name, p as Record<string, unknown>, p.children ? (renderNode(p.children) as React.ReactNode) : undefined),
  });
});
const library = createLibrary({ components, root: "Stack" } as never);

function View({ stream, onDone, onError }: ViewProps) {
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(true);
  useEffect(() => {
    readText(stream, setText).then(() => {
      setStreaming(false);
      onDone();
    }, onError);
  }, []);
  return <Renderer response={text} library={library} isStreaming={streaming} />;
}

installHarness(reactContender("openui", View));
