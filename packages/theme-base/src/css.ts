/**
 * The base theme's styles, as strings.
 *
 * Each is built inside a pure-annotated function: the template literals call
 * a helper, and without the annotation a bundler must keep them, shipping 11 KB
 * of CSS text to pages that only use the lazy loaders.
 *
 * Kept in TypeScript rather than a .css file so there is one source for both
 * ways a host takes them: the build writes `dist/theme.css` for a page to link,
 * and phase 4's Web Component adopts the same text into its shadow root.
 *
 * Two layers with one rule between them (T1): `tokens` is the only place a
 * colour is written; `components` reads tokens and nothing else. A theme is
 * changed by overriding custom properties, never by editing selectors.
 *
 * Every rule is scoped under `.gen-theme`, the class the renderer's root
 * carries, so the base theme cannot style anything else on the host page.
 */

const LIGHT = `
  --gen-color-surface: #ffffff;
  --gen-color-surface-variant: #f4f5f8;
  --gen-color-on-surface: #16171d;
  --gen-color-on-surface-variant: #555968;
  --gen-color-outline: #d3d6de;
  --gen-color-primary: #1a5fb4;
  --gen-color-on-primary: #ffffff;
  --gen-color-neutral-container: #eceef2;
  --gen-color-on-neutral-container: #2c2f38;
  --gen-color-info: #1a5fb4;
  --gen-color-info-container: #e3eefb;
  --gen-color-on-info-container: #0d3a73;
  --gen-color-success: #1b7339;
  --gen-color-success-container: #e2f4e8;
  --gen-color-on-success-container: #0f4a24;
  --gen-color-warning: #8f5400;
  --gen-color-warning-container: #fdf1dc;
  --gen-color-on-warning-container: #5c3600;
  --gen-color-danger: #b3261e;
  --gen-color-danger-container: #fbe4e2;
  --gen-color-on-danger-container: #6e1410;
  --gen-color-chart-1: #1a5fb4;
  --gen-color-chart-2: #c25700;
  --gen-color-chart-3: #1b7339;
  --gen-color-chart-4: #7b3fb0;`;

const DARK = `
  --gen-color-surface: #15161b;
  --gen-color-surface-variant: #1e2028;
  --gen-color-on-surface: #ececf1;
  --gen-color-on-surface-variant: #a9adbb;
  --gen-color-outline: #3a3d4a;
  --gen-color-primary: #8ab4f8;
  --gen-color-on-primary: #0b1f3d;
  --gen-color-neutral-container: #2a2d36;
  --gen-color-on-neutral-container: #dfe1e8;
  --gen-color-info: #8ab4f8;
  --gen-color-info-container: #172a45;
  --gen-color-on-info-container: #cfe0ff;
  --gen-color-success: #6fcf8f;
  --gen-color-success-container: #15301f;
  --gen-color-on-success-container: #c9f0d5;
  --gen-color-warning: #f2b85b;
  --gen-color-warning-container: #3a2a10;
  --gen-color-on-warning-container: #fde3b5;
  --gen-color-danger: #f28b82;
  --gen-color-danger-container: #3d1513;
  --gen-color-on-danger-container: #fcd6d2;
  --gen-color-chart-1: #8ab4f8;
  --gen-color-chart-2: #f2a65a;
  --gen-color-chart-3: #6fcf8f;
  --gen-color-chart-4: #c79bf2;`;

/** Custom properties, and the variants that override them (FR-231, FR-232). */
export const tokens: string = /* @__PURE__ */ (() => `
.gen-theme {${LIGHT}
  --gen-font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --gen-font-size-1: 0.8125rem;
  --gen-font-size-2: 0.9375rem;
  --gen-font-size-3: 1.125rem;
  --gen-font-size-4: 1.5rem;
  --gen-font-size-5: 2rem;
  --gen-line-height: 1.5;
  --gen-space-unit: 0.25rem;
  --gen-radius-s: 4px;
  --gen-radius-m: 8px;
  --gen-radius-l: 12px;
  color-scheme: light;
}
.gen-theme[data-gen-variant="dark"] {${DARK}
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  .gen-theme[data-gen-variant="auto"] {${DARK}
    color-scheme: dark;
  }
}
.gen-theme[data-gen-density="compact"] {
  --gen-space-unit: 0.1875rem;
  --gen-font-size-1: 0.75rem;
  --gen-font-size-2: 0.875rem;
  --gen-font-size-3: 1rem;
  --gen-font-size-4: 1.25rem;
  --gen-font-size-5: 1.625rem;
  --gen-line-height: 1.4;
}
`)();

const s = (n: number) => `calc(var(--gen-space-unit) * ${n})`;

/** The twelve components. Reads tokens only (T1). */
export const components: string = /* @__PURE__ */ (() => `
.gen-theme {
  container-type: inline-size;
  font-family: var(--gen-font-family);
  font-size: var(--gen-font-size-2);
  line-height: var(--gen-line-height);
  color: var(--gen-color-on-surface);
  background: var(--gen-color-surface);
}
.gen-theme *, .gen-theme *::before, .gen-theme *::after { box-sizing: border-box; }
.gen-theme p, .gen-theme figure, .gen-theme h1, .gen-theme h2, .gen-theme h3, .gen-theme h4 { margin: 0; }

.gen-theme .gen-stack { display: flex; flex-direction: column; min-width: 0; }
.gen-theme .gen-stack--row { flex-direction: row; flex-wrap: wrap; align-items: flex-start; }
.gen-theme .gen-gap--sm { gap: ${s(2)}; }
.gen-theme .gen-gap--md { gap: ${s(4)}; }
.gen-theme .gen-gap--lg { gap: ${s(7)}; }

.gen-theme .gen-grid { display: grid; gap: ${s(4)}; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.gen-theme .gen-grid--1 { grid-template-columns: minmax(0, 1fr); }
.gen-theme .gen-grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.gen-theme .gen-grid--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@container (max-width: 720px) {
  .gen-theme .gen-grid--3, .gen-theme .gen-grid--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container (max-width: 420px) {
  .gen-theme .gen-grid { grid-template-columns: minmax(0, 1fr); }
}

.gen-theme .gen-card, .gen-theme .gen-metric, .gen-theme .gen-chart {
  background: var(--gen-color-surface-variant);
  border: 1px solid var(--gen-color-outline);
  border-radius: var(--gen-radius-l);
  padding: ${s(4)} ${s(4)};
  min-width: 0;
}
.gen-theme .gen-card { display: flex; flex-direction: column; gap: ${s(3)}; }
.gen-theme .gen-card__title { font-size: var(--gen-font-size-3); font-weight: 600; }
.gen-theme .gen-card__subtitle { color: var(--gen-color-on-surface-variant); font-size: var(--gen-font-size-1); }
.gen-theme .gen-card__body { display: flex; flex-direction: column; gap: ${s(3)}; }

.gen-theme .gen-heading { font-weight: 650; line-height: 1.2; }
.gen-theme .gen-heading--1 { font-size: var(--gen-font-size-5); }
.gen-theme .gen-heading--2 { font-size: var(--gen-font-size-4); }
.gen-theme .gen-heading--3 { font-size: var(--gen-font-size-3); }
.gen-theme .gen-heading--4 { font-size: var(--gen-font-size-2); }

.gen-theme .gen-text { white-space: pre-line; overflow-wrap: anywhere; }
.gen-theme .gen-text--muted { color: var(--gen-color-on-surface-variant); }

.gen-theme .gen-metric__label { font-size: var(--gen-font-size-1); color: var(--gen-color-on-surface-variant); }
.gen-theme .gen-metric__value { font-size: var(--gen-font-size-5); font-weight: 650; line-height: 1.15; overflow-wrap: anywhere; }
.gen-theme .gen-metric__trend { font-size: var(--gen-font-size-2); margin-inline-start: ${s(1.5)}; }
.gen-theme .gen-metric__trend--up { color: var(--gen-color-success); }
.gen-theme .gen-metric__trend--down { color: var(--gen-color-danger); }
.gen-theme .gen-metric__trend--flat { color: var(--gen-color-on-surface-variant); }
.gen-theme .gen-metric__caption { font-size: var(--gen-font-size-1); color: var(--gen-color-on-surface-variant); margin-top: ${s(1)}; }

.gen-theme .gen-list { margin: 0; padding-inline-start: ${s(6)}; display: flex; flex-direction: column; gap: ${s(1)}; }

.gen-theme .gen-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--gen-color-outline);
  border-radius: var(--gen-radius-m);
  font-size: var(--gen-font-size-1);
}
.gen-theme .gen-table caption { caption-side: top; text-align: start; padding: 0 0 ${s(2)}; color: var(--gen-color-on-surface-variant); }
.gen-theme .gen-table th, .gen-theme .gen-table td { text-align: start; vertical-align: top; padding: ${s(2)} ${s(3)}; border-top: 1px solid var(--gen-color-outline); overflow-wrap: anywhere; }
.gen-theme .gen-table thead th { border-top: 0; font-weight: 600; }

.gen-theme .gen-callout {
  border-radius: var(--gen-radius-m);
  border-inline-start: ${s(1)} solid var(--gen-tone);
  background: var(--gen-tone-container);
  color: var(--gen-on-tone-container);
  padding: ${s(3)} ${s(4)};
}
.gen-theme .gen-callout__title { font-weight: 600; }
.gen-theme .gen-callout__body { margin-top: ${s(1)}; }

.gen-theme .gen-badge {
  display: inline-block;
  align-self: flex-start;
  border-radius: 999px;
  padding: ${s(0.5)} ${s(2.5)};
  font-size: var(--gen-font-size-1);
  font-weight: 600;
  background: var(--gen-tone-container);
  color: var(--gen-on-tone-container);
}

.gen-theme .gen-tone--neutral { --gen-tone: var(--gen-color-outline); --gen-tone-container: var(--gen-color-neutral-container); --gen-on-tone-container: var(--gen-color-on-neutral-container); }
.gen-theme .gen-tone--info { --gen-tone: var(--gen-color-info); --gen-tone-container: var(--gen-color-info-container); --gen-on-tone-container: var(--gen-color-on-info-container); }
.gen-theme .gen-tone--success { --gen-tone: var(--gen-color-success); --gen-tone-container: var(--gen-color-success-container); --gen-on-tone-container: var(--gen-color-on-success-container); }
.gen-theme .gen-tone--warning { --gen-tone: var(--gen-color-warning); --gen-tone-container: var(--gen-color-warning-container); --gen-on-tone-container: var(--gen-color-on-warning-container); }
.gen-theme .gen-tone--danger { --gen-tone: var(--gen-color-danger); --gen-tone-container: var(--gen-color-danger-container); --gen-on-tone-container: var(--gen-color-on-danger-container); }

.gen-theme .gen-link { color: var(--gen-color-primary); text-decoration: underline; text-underline-offset: 2px; align-self: flex-start; }
.gen-theme .gen-link:focus-visible { outline: 2px solid var(--gen-color-primary); outline-offset: 2px; border-radius: var(--gen-radius-s); }

.gen-theme .gen-chart__title { font-weight: 600; margin-bottom: ${s(2)}; }
.gen-theme .gen-chart__plot { display: block; width: 100%; height: auto; aspect-ratio: 5 / 2; overflow: visible; }
.gen-theme .gen-chart__axis { stroke: var(--gen-color-outline); stroke-width: 1; }
.gen-theme .gen-chart__label { fill: var(--gen-color-on-surface-variant); font-size: 15px; text-anchor: middle; }
.gen-theme .gen-chart__line { fill: none; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
.gen-theme .gen-chart__legend { list-style: none; margin: ${s(2)} 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: ${s(3)}; font-size: var(--gen-font-size-1); color: var(--gen-color-on-surface-variant); }
.gen-theme .gen-chart__swatch { display: inline-block; width: 0.7em; height: 0.7em; border-radius: 2px; margin-inline-end: ${s(1.5)}; background: var(--gen-series); }
.gen-theme .gen-chart--s1 { --gen-series: var(--gen-color-chart-1); fill: var(--gen-series); stroke: var(--gen-series); }
.gen-theme .gen-chart--s2 { --gen-series: var(--gen-color-chart-2); fill: var(--gen-series); stroke: var(--gen-series); }
.gen-theme .gen-chart--s3 { --gen-series: var(--gen-color-chart-3); fill: var(--gen-series); stroke: var(--gen-series); }
.gen-theme .gen-chart--s4 { --gen-series: var(--gen-color-chart-4); fill: var(--gen-series); stroke: var(--gen-series); }
.gen-theme .gen-chart__line.gen-chart--s1, .gen-theme .gen-chart__line.gen-chart--s2,
.gen-theme .gen-chart__line.gen-chart--s3, .gen-theme .gen-chart__line.gen-chart--s4 { fill: none; }

@media (prefers-reduced-motion: no-preference) {
  .gen-theme .gen-chart__bar { transition: y 160ms ease-out, height 160ms ease-out; }
}
`)();

/** Tokens and components together: what `dist/theme.css` contains. */
export const themeCss: string = /* @__PURE__ */ (() => `${tokens}
${components}`)();

/** The variants a host may set on the `.gen-theme` root. */
export const VARIANTS = ["light", "dark", "auto"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export type Variant = (typeof VARIANTS)[number];
export type Density = (typeof DENSITIES)[number];

/**
 * Attributes for the root element. Switching them restyles in place: nothing
 * in a component's markup depends on the variant (FR-232).
 */
export function themeAttributes(variant: Variant = "light", density: Density = "comfortable"): Record<string, string> {
  return { class: "gen-theme", "data-gen-variant": variant, "data-gen-density": density };
}
