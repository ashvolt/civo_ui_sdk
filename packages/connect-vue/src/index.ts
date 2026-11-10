/**
 * relax-ui-connect-vue — Vue component libraries (Element Plus, Vuetify, your
 * own) as a `<gen-ui>` connector.
 *
 *   import { vueConnector } from "relax-ui-connect-vue";
 *   el.connectors = [vueConnector({ name: "element-plus", app, implementations: { Card: GenCard } })];
 *
 * Each implementation is an ordinary Vue component. Its props are the node's
 * validated props, and its default slot is where the renderer's children go.
 * It never renders model children itself, and never sees an invalid prop (data
 * model I1, I3). Given the host's `app`, components share its context: its
 * plugins, global components and provided values.
 *
 * Vue is the only peer; `defineConnector` is compiled in.
 */
import { h, render, type App, type Component } from "vue";
import { defineConnector, type Connector, type Implementation, type MountImplementation } from "relax-ui-render";

/** A component loaded on first use: `lazyComponent(() => import("./GenCard.vue"))`. */
export interface LazyComponent {
  readonly load: () => Promise<Component | { default: Component }>;
}

export function lazyComponent(load: LazyComponent["load"]): LazyComponent {
  return { load };
}

export interface VueConnectorOptions {
  /** Names the library in reports and errors, e.g. `element-plus`. */
  name: string;
  /** The host application, whose plugins and provided values components see. */
  app?: App;
  /** Contract type → component, or a lazily loaded one. */
  implementations: Readonly<Record<string, Component | LazyComponent>>;
  /** True when the library is ready on this page. */
  requires?: () => boolean;
  /** `data-` attributes or classes for the surface, per variant. */
  variants?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * A framework connector for Vue components. Always `light` mode (K2): Vue
 * libraries ship global stylesheets, which no shadow root sees.
 */
export function vueConnector(options: VueConnectorOptions): Connector {
  const implementations: Record<string, MountImplementation | (() => Promise<Implementation>)> = {};
  for (const [type, entry] of Object.entries(options.implementations)) {
    implementations[type] = isLazy(entry)
      ? () => entry.load().then((m) => mountVue(isModule(m) ? m.default : m, options.app))
      : mountVue(entry as Component, options.app);
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
 * Renders one component into the host the renderer created. Vue's `render`
 * patches synchronously, so an update reuses the component instance and the
 * child host stays where the component put it.
 */
export function mountVue(component: Component, app?: App): MountImplementation {
  return {
    mount(host, props, childHost) {
      const slot = () => h(ChildHost, { host: childHost });
      const draw = (p: Record<string, unknown>) => {
        const vnode = h(component, p, { default: slot });
        if (app) vnode.appContext = app._context;
        render(vnode, host);
      };
      draw(props);
      return {
        update: draw,
        unmount: () => render(null, host),
      };
    },
  };
}

/**
 * Where a component's children go: an element with no box of its own, into
 * which the renderer's child host is moved. `display: contents` is set through
 * the CSSOM, which a strict `style-src` allows.
 */
const ChildHost = {
  name: "GenChildren",
  props: { host: { type: Object, required: true } },
  setup(props: { host: Element }) {
    const place = (el: unknown) => {
      if (el instanceof Element && props.host.parentNode !== el) el.appendChild(props.host);
    };
    return () => h("div", { ref: place, "data-gen-children": "", style: { display: "contents" } });
  },
};

function isLazy(entry: unknown): entry is LazyComponent {
  return typeof entry === "object" && entry !== null && typeof (entry as LazyComponent).load === "function";
}

function isModule(m: unknown): m is { default: Component } {
  return typeof m === "object" && m !== null && "default" in m;
}
