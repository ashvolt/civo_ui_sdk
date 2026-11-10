/**
 * relax-ui-connect-angular — Angular component libraries (Angular Material,
 * PrimeNG, your own) as a `<gen-ui>` connector.
 *
 *   import { angularConnector } from "relax-ui-connect-angular";
 *   el.connectors = [angularConnector({
 *     name: "angular-material",
 *     injector: inject(EnvironmentInjector),
 *     implementations: { Card: GenMatCard, Metric: GenMatMetric },
 *   })];
 *
 * Each implementation is an ordinary standalone component. Its inputs are the
 * node's validated props (only those it declares), and the renderer's children
 * are projected into its `<ng-content>`. It never renders model children
 * itself, and never sees an invalid prop (data model I1, I3). Components are
 * created in the host application's injector, so they see its providers.
 *
 * `@angular/core` is the only peer; `defineConnector` is compiled in.
 */
import {
  ApplicationRef,
  createComponent,
  reflectComponentType,
  type EnvironmentInjector,
  type Type,
} from "@angular/core";
import {
  defineConnector,
  type Connector,
  type Implementation,
  type MountImplementation,
} from "relax-ui-render";

/** A component loaded on first use: `lazyComponent(() => import("./gen-card"))`. */
export interface LazyComponent {
  readonly load: () => Promise<Type<unknown> | { default: Type<unknown> }>;
}

export function lazyComponent(load: LazyComponent["load"]): LazyComponent {
  return { load };
}

export interface AngularConnectorOptions {
  /** Names the library in reports and errors, e.g. `angular-material`. */
  name: string;
  /** The application's injector: `inject(EnvironmentInjector)`. */
  injector: EnvironmentInjector;
  /** Contract type → standalone component, or a lazily loaded one. */
  implementations: Readonly<Record<string, Type<unknown> | LazyComponent>>;
  /** True when the library is ready on this page. */
  requires?: () => boolean;
  /** `data-` attributes or classes for the surface, per variant. */
  variants?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * A framework connector for Angular components. Always `light` mode (K2):
 * Angular adds component styles to `document.head`, which no shadow root sees.
 */
export function angularConnector(options: AngularConnectorOptions): Connector {
  const implementations: Record<string, MountImplementation | (() => Promise<Implementation>)> = {};
  for (const [type, entry] of Object.entries(options.implementations)) {
    implementations[type] = isLazy(entry)
      ? () => entry.load().then((m) => mountAngular(isModule(m) ? m.default : m, options.injector))
      : mountAngular(entry as Type<unknown>, options.injector);
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
 * Creates the component on the host element the renderer made, with the child
 * host projected into its first `<ng-content>`, and checks it synchronously so
 * it is drawn before the renderer moves on. Attached to the application, so
 * the application's own change detection reaches it too.
 */
export function mountAngular(component: Type<unknown>, injector: EnvironmentInjector): MountImplementation {
  let inputs: string[] | undefined;
  return {
    mount(host, props, childHost) {
      inputs ??= (reflectComponentType(component)?.inputs ?? []).map((i) => i.templateName);
      const ref = createComponent(component, {
        environmentInjector: injector,
        hostElement: host,
        projectableNodes: [[childHost]],
      });
      const set = (p: Record<string, unknown>) => {
        // Every declared input, so a prop that disappears is cleared.
        for (const name of inputs!) ref.setInput(name, p[name]);
        ref.changeDetectorRef.detectChanges();
      };
      set(props);
      const app = injector.get(ApplicationRef);
      app.attachView(ref.hostView);
      return {
        update: set,
        unmount: () => {
          app.detachView(ref.hostView);
          ref.destroy();
        },
      };
    },
  };
}

function isLazy(entry: unknown): entry is LazyComponent {
  return typeof entry === "object" && entry !== null && typeof (entry as LazyComponent).load === "function";
}

function isModule(m: unknown): m is { default: Type<unknown> } {
  return typeof m === "object" && m !== null && "default" in m;
}
