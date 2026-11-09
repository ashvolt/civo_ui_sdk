import type { BaseComponentName, BaseTemplates } from "./props.js";

/**
 * The base theme, loaded on first use (FR-240).
 *
 * Each loader is a dynamic `import()` of a same-origin chunk, which a bundler
 * splits out and a strict CSP (`script-src 'self'`, no `unsafe-eval`) allows.
 * Components that nearly always appear together share a chunk, so a typical
 * dashboard costs three small fetches rather than twelve.
 *
 * A loader resolves to the template itself. A catalog calls each at most once
 * per page and shares the promise (data model G2).
 */
type Loader<K extends BaseComponentName> = () => Promise<BaseTemplates[K]>;

const layout = () => import("./components/layout.js");
const text = () => import("./components/text.js");

export const baseLoaders: { [K in BaseComponentName]: Loader<K> } = {
  Stack: () => layout().then((m) => m.Stack),
  Grid: () => layout().then((m) => m.Grid),
  Card: () => layout().then((m) => m.Card),
  Heading: () => text().then((m) => m.Heading),
  Text: () => text().then((m) => m.Text),
  List: () => text().then((m) => m.List),
  Link: () => text().then((m) => m.Link),
  Badge: () => text().then((m) => m.Badge),
  Callout: () => text().then((m) => m.Callout),
  Metric: () => import("./components/metric.js").then((m) => m.Metric),
  Table: () => import("./components/table.js").then((m) => m.Table),
  Chart: () => import("./components/chart.js").then((m) => m.Chart),
};
