import { defineConnector, type Connector, type Template } from "relax-ui-render";
import { kitCssUrl } from "./css.ts";
import { kitTemplates } from "./templates.ts";

export { installKitCss, kitCss, kitCssUrl } from "./css.ts";
export { formatCount, HEAT_LEVELS, kitTemplates } from "./templates.ts";
export type { KitName, KitProps } from "./templates.ts";

let connector: Connector | undefined;

/**
 * The kit as a connector for `<gen-ui>`: template implementations for the
 * bench contract's four extra types, and the kit's styles for its shadow root.
 * The same route any host takes to add components of its own.
 */
export function kitConnector(): Connector {
  connector ??= defineConnector({
    name: "bench-kit",
    kind: "class",
    mode: "shadow",
    stylesheets: [kitCssUrl()],
    implementations: Object.fromEntries(
      Object.entries(kitTemplates).map(([type, template]) => [type, { template: template as unknown as Template }]),
    ),
  });
  return connector;
}
