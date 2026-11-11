/**
 * The kit's styles. Like the base theme's `components` layer, they read
 * base-theme tokens and write no colour of their own (T1): every colour is a
 * `var(--gen-…)` or a `color-mix()` of two of them, so the light and dark
 * variants restyle the kit with no rule of its own.
 *
 * Animation is declared only inside `prefers-reduced-motion: no-preference`;
 * a reader who asks for less motion gets none (spec scenario 5).
 */

const s = (n: number) => `calc(var(--gen-space-unit) * ${n})`;

/** Heat level l of 5, mixed from the first series colour into the surface. */
const heat = (l: number) =>
  l === 4 ? "var(--gen-color-chart-1)" : `color-mix(in srgb, var(--gen-color-chart-1) ${20 + l * 20}%, var(--gen-color-surface))`;

export const kitCss = `
.gen-theme .gen-heat, .gen-theme .gen-sparks, .gen-theme .gen-counter {
  background: var(--gen-color-surface); color: var(--gen-color-on-surface);
  border: 1px solid var(--gen-color-outline); border-radius: var(--gen-radius-m); padding: ${s(4)}; margin: 0;
}
.gen-theme .gen-heat__title { font-weight: 600; margin-bottom: ${s(2)}; }
.gen-theme .gen-heat__plot { display: block; width: 100%; height: auto; aspect-ratio: 5 / 2; }
.gen-theme .gen-heat__cell { stroke: var(--gen-color-surface); stroke-width: 0.04; }
${[0, 1, 2, 3, 4].map((l) => `.gen-theme .gen-heat--l${l} { fill: ${heat(l)}; background: ${heat(l)}; }`).join("\n")}
.gen-theme .gen-heat__legend { list-style: none; margin: ${s(2)} 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: ${s(3)}; font-size: var(--gen-font-size-1); color: var(--gen-color-on-surface-variant); }
.gen-theme .gen-heat__swatch { display: inline-block; width: 0.9em; height: 0.9em; border-radius: 2px; margin-inline-end: ${s(1.5)}; vertical-align: -0.1em; border: 1px solid var(--gen-color-outline); }

.gen-theme .gen-scatter__pt { fill-opacity: 0.75; stroke: none; }

.gen-theme .gen-sparks { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: ${s(2)}; }
.gen-theme .gen-spark { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 0 ${s(2)}; padding: ${s(1)} ${s(2)}; background: var(--gen-color-surface-variant); border-radius: var(--gen-radius-s); }
.gen-theme .gen-spark__label { font-size: var(--gen-font-size-1); color: var(--gen-color-on-surface-variant); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gen-theme .gen-spark__value { font-size: var(--gen-font-size-1); font-variant-numeric: tabular-nums; color: var(--gen-color-on-surface); }
.gen-theme .gen-spark__plot { grid-column: 1 / -1; display: block; width: 100%; height: 1.5rem; }
.gen-theme .gen-spark__plot .gen-chart__line { stroke-width: 1.5; vector-effect: non-scaling-stroke; }

.gen-theme .gen-counter { position: relative; overflow: hidden; }
.gen-theme .gen-counter__label { margin: 0; font-size: var(--gen-font-size-1); color: var(--gen-color-on-surface-variant); }
.gen-theme .gen-counter__value { margin: ${s(1)} 0 0; font-size: var(--gen-font-size-4); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--gen-color-on-surface); }
.gen-theme .gen-counter__bar { position: absolute; inset: auto 0 0 0; height: 3px; background: var(--gen-tone, var(--gen-color-primary)); transform-origin: left; }
.gen-theme .gen-counter--info { --gen-tone: var(--gen-color-info); }
.gen-theme .gen-counter--success { --gen-tone: var(--gen-color-success); }
.gen-theme .gen-counter--warning { --gen-tone: var(--gen-color-warning); }
.gen-theme .gen-counter--danger { --gen-tone: var(--gen-color-danger); }

@media (prefers-reduced-motion: no-preference) {
  @keyframes gen-counter-in { from { opacity: 0; transform: translateY(0.5em); } to { opacity: 1; transform: none; } }
  @keyframes gen-counter-live { 0%, 100% { transform: scaleX(0.15); } 50% { transform: scaleX(1); } }
  .gen-theme .gen-counter__value { animation: gen-counter-in 400ms ease-out both; }
  .gen-theme .gen-counter__bar { animation: gen-counter-live 1600ms ease-in-out infinite; }
}
`;

/** Puts the kit's styles on a page whose renderer draws into the light DOM. */
export function installKitCss(doc: Document = document): void {
  if (doc.querySelector("style[data-bench-kit]")) return;
  const style = doc.createElement("style");
  style.setAttribute("data-bench-kit", "");
  style.textContent = kitCss;
  doc.head.append(style);
}

/** A URL a shadow root can adopt the kit's styles from. */
export function kitCssUrl(): string {
  return URL.createObjectURL(new Blob([kitCss], { type: "text/css" }));
}
