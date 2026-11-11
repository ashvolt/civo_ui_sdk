/**
 * This SDK's element with a framework connector: Card and Metric are React
 * components mounted by `relax-ui-connect-react`, in light mode, as a host
 * plugs in its own React library (feature 003, K2). For the soak (T-421):
 * every mount and unmount is counted, so a component left mounted after its
 * node is gone shows as growth.
 */
import { createElement, type ReactNode } from "react";
import { reactConnector } from "relax-ui-connect-react";
import { fromTemplates } from "relax-ui-react";
import { defineConnector, type MountImplementation } from "relax-ui-render";
import { baseTemplates } from "relax-ui-theme-base";
import { elementAdapter } from "../src/adapters/element.ts";
import { installKitCss } from "../src/kit/index.ts";
import { installHarness } from "../src/probe/page.ts";
import type { Node } from "../src/workloads/generator.ts";

const MOUNTED_TYPES = ["Card", "Metric"] as const;

// The base theme's own markup, drawn by React components.
const drawn = fromTemplates({ Card: baseTemplates.Card, Metric: baseTemplates.Metric });
const component =
  (type: (typeof MOUNTED_TYPES)[number]) =>
  ({ children, ...props }: { children?: ReactNode }) =>
    createElement(drawn[type], { props: props as never, children, node: undefined as never });

const inner = reactConnector({
  name: "bench-react",
  implementations: { Card: component("Card"), Metric: component("Metric") },
});

let live = 0;
const counted = defineConnector({
  ...inner,
  implementations: Object.fromEntries(
    Object.entries(inner.implementations).map(([type, impl]) => {
      const mount = impl as MountImplementation;
      const wrapped: MountImplementation = {
        mount(host, props, childHost) {
          const m = mount.mount(host, props, childHost);
          live++;
          let gone = false;
          return {
            update: (next) => m.update(next),
            unmount() {
              if (!gone) {
                gone = true;
                live--;
              }
              m.unmount();
            },
          };
        },
      };
      return [type, wrapped];
    }),
  ),
});

function countTypes(node: Node | undefined): number {
  if (!node) return 0;
  let n = (MOUNTED_TYPES as readonly string[]).includes(node.type) ? 1 : 0;
  for (const c of node.children ?? []) n += countTypes(c);
  return n;
}

installKitCss();
installHarness({
  ...elementAdapter("ours-connect-react", { mode: "light", connectors: [counted] }),
  mountedComponents: () => live,
  expectedComponents: (doc) => countTypes((doc as { root?: Node }).root),
});
