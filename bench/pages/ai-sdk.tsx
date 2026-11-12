/**
 * The AI SDK baseline (T-434): `useObject` reads the response as partial JSON;
 * rendering is the application's own React, here a recursive component that
 * draws the kit. No component registry, no validation of partial props.
 */
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { useEffect } from "react";
import { z } from "zod";
import { reactContender, type ViewProps } from "../src/adapters/react-contender.tsx";
import { drawReact } from "../src/kit/react.ts";
import { installHarness } from "../src/probe/page.ts";

interface Partial {
  type?: string;
  key?: string;
  props?: Record<string, unknown>;
  children?: (Partial | undefined)[];
}

function Tree({ node }: { node: Partial | undefined }) {
  if (!node?.type) return null;
  const kids = node.children?.map((c, i) => <Tree key={c?.key ?? i} node={c} />);
  return drawReact(node.type, node.props, kids);
}

const schema = z.object({ root: z.any() });

function View({ fetch, onDone, onError }: ViewProps) {
  const { object, submit } = useObject({ api: "/__bench/ai-sdk", schema, fetch, onFinish: () => onDone(), onError });
  // A block body: an effect's return value is its cleanup, and submit's is not a function.
  useEffect(() => {
    submit(undefined);
  }, []);
  return <Tree node={(object as { root?: Partial } | undefined)?.root} />;
}

installHarness(reactContender("ai-sdk", View));
