import { defineConnector, type Connector } from "relax-ui-element";

/**
 * Shoelace through the element connector (FR-235): the root of each mapped
 * component becomes the library's own element; attributes come from props.
 *
 * Shoelace styles inside its own shadow roots and is themed by custom
 * properties, which inherit through ours, so it works in the default isolated
 * mode. Its elements must be registered before rendering; `requires` checks.
 *
 * Its dark theme is a class, `sl-theme-dark`, whose tokens are in a separate
 * stylesheet. Given `darkStylesheet`, that sheet is adopted into the element's
 * shadow root and the class follows the element's variant. (Shoelace's file
 * also targets `:host`, which would make every host dark; the example's build
 * serves a copy without it.)
 *
 * Given `stylesheet`, the URL of `shoelace.css` beside this file, that is
 * adopted too: it lets a badge wrap a long word rather than run out of its box.
 */
export function shoelace(options: { darkStylesheet?: string; stylesheet?: string } = {}): Connector {
  return defineConnector({
    name: "shoelace",
    kind: "element",
    mode: "shadow",
    stylesheets: [options.stylesheet, options.darkStylesheet].filter((s): s is string => s !== undefined),
    variants: options.darkStylesheet ? { dark: { class: "sl-theme-dark" } } : {},
    requires: () => ["sl-card", "sl-alert", "sl-badge"].every((tag) => customElements.get(tag) !== undefined),
    implementations: {
      Card: { tag: "sl-card", slots: { title: "header" } },
      Metric: { tag: "sl-card" },
      Callout: {
        tag: "sl-alert",
        props: {
          open: true,
          variant: { from: "tone", map: { info: "primary", success: "success", warning: "warning", danger: "danger" } },
        },
      },
      Badge: {
        tag: "sl-badge",
        props: {
          pill: true,
          variant: {
            from: "tone",
            map: { neutral: "neutral", info: "primary", success: "success", warning: "warning", danger: "danger" },
          },
        },
      },
    },
  });
}
