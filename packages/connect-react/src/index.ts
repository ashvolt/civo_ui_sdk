/**
 * relax-ui-connect-react — React component libraries (MUI, Chakra, your own)
 * as a `<gen-ui>` connector.
 *
 *   import { reactConnector } from "relax-ui-connect-react";
 *   el.connectors = [reactConnector({ name: "mui", implementations: { Card: MuiCard } })];
 *
 * Each implementation is an ordinary React component. It receives the node's
 * validated props, and `children`: a placeholder for the children the
 * renderer draws, which it puts wherever its children belong. It never renders
 * model children itself, and never sees an invalid prop (data model I1, I3).
 *
 * React and React DOM are peers; `defineConnector` is compiled in.
 */
import { createElement, useCallback, type ComponentType, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { defineConnector, type Connector, type Implementation, type MountImplementation } from "relax-ui-render";

/** What a component receives: the node's props, and where its children go. */
export type GenProps<P = Record<string, unknown>> = P & { children: ReactNode };

/** A component loaded on first use: `lazyComponent(() => import("./Card"))`. */
export interface LazyComponent {
  readonly load: () => Promise<ComponentType<never> | { default: ComponentType<never> }>;
}

export function lazyComponent(load: LazyComponent["load"]): LazyComponent {
  return { load };
}

export interface ReactConnectorOptions {
  /** Names the library in reports and errors, e.g. `mui`. */
  name: string;
  /** Contract type → component, or a lazily loaded one. */
  implementations: Readonly<Record<string, ComponentType<never> | LazyComponent>>;
  /** True when the library is ready on this page. */
  requires?: () => boolean;
  /** `data-` attributes or classes for the surface, per variant. */
  variants?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * A framework connector for React components. Always `light` mode (K2): React
 * libraries inject their styles into `document.head`, which no shadow root sees.
 */
export function reactConnector(options: ReactConnectorOptions): Connector {
  const implementations: Record<string, MountImplementation | (() => Promise<Implementation>)> = {};
  for (const [type, entry] of Object.entries(options.implementations)) {
    implementations[type] = isLazy(entry)
      ? () => entry.load().then((m) => mountReact("default" in m && typeof m !== "function" ? m.default : (m as ComponentType<never>)))
      : mountReact(entry);
  }
  return defineConnector({
    name: options.name,
    kind: "framework",
    mode: "light",
    implementations,
    ...(options.requires ? { requires: options.requires } : {}),
    ...(options.variants ? { variants: options.variants } : {}),
  });
}

/**
 * One React root per mounted node (T-254 measured this against a shared root;
 * see the README). Rendered synchronously, so the renderer's children land in
 * a child host that is already in place.
 */
export function mountReact(Component: ComponentType<never>): MountImplementation {
  return {
    mount(host, props, childHost) {
      const root = createRoot(host);
      const children = createElement(ChildHost, { host: childHost });
      const draw = (p: Record<string, unknown>) =>
        flushSync(() => root.render(createElement(Component as ComponentType<Record<string, unknown>>, { ...p, children })));
      draw(props);
      return {
        update: draw,
        unmount: () => root.unmount(),
      };
    },
  };
}

/**
 * Where a component's children go: an element with no box of its own, into
 * which the renderer's child host is moved. `display: contents` is set through
 * the CSSOM, which a strict `style-src` allows.
 */
function ChildHost({ host }: { host: Element }) {
  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (el && host.parentNode !== el) el.appendChild(host);
    },
    [host],
  );
  return createElement("div", { ref, "data-gen-children": "", style: { display: "contents" } });
}

function isLazy(entry: unknown): entry is LazyComponent {
  return typeof entry === "object" && entry !== null && typeof (entry as LazyComponent).load === "function";
}
