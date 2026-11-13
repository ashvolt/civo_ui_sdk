import { defineConnector, type Connector } from "relax-ui-element";

/**
 * Bootstrap 5 through the class connector: a declarative mapping, no code
 * (FR-234). The base theme's markup is kept — its structure, text handling and
 * ARIA roles — and its `gen-` classes are swapped for Bootstrap's.
 *
 * Chart is left out on purpose: Bootstrap has no chart, so the base theme draws
 * it, and the element reports the fallback (FR-237).
 *
 * Two ways to use it:
 *
 *   bootstrap5()                                  mode="light"; the page loads Bootstrap
 *   bootstrap5({ stylesheet: "/vendor/bs.css" })  also mode="shadow"; adopted once, shared
 */
export function bootstrap5(options: { stylesheet?: string } = {}): Connector {
  const { stylesheet } = options;
  return defineConnector({
    name: "bootstrap-5",
    kind: "class",
    mode: "light",
    stylesheets: stylesheet ? [stylesheet] : [],
    // Bootstrap 5.3's own colour modes follow the element's variant.
    variants: { light: { "data-bs-theme": "light" }, dark: { "data-bs-theme": "dark" } },
    // Bootstrap 5 declares its colours as custom properties on :root.
    requires: () =>
      stylesheet !== undefined ||
      getComputedStyle(document.documentElement).getPropertyValue("--bs-primary").trim() !== "",
    implementations: {
      Stack: {
        classes: {
          root: "d-flex",
          variant: { column: "flex-column", row: "flex-row flex-wrap align-items-start" },
          gap: { sm: "gap-2", md: "gap-3", lg: "gap-4" },
        },
      },
      // Bootstrap's .row gutters pad each column inside its own border, so a
      // card placed directly in a row has no visible gap. Flex with gap does.
      Grid: { classes: { root: "d-flex flex-column flex-md-row flex-wrap gap-3" } },
      Card: {
        classes: {
          root: "card",
          title: "card-header fw-semibold",
          subtitle: "card-subtitle text-body-secondary small px-3 pt-2",
          body: "card-body d-flex flex-column gap-3",
        },
      },
      Heading: { classes: { root: "mb-0", variant: { "1": "h3", "2": "h4", "3": "h5", "4": "h6" } } },
      Text: { classes: { root: "mb-0", variant: { muted: "text-body-secondary" } } },
      Metric: {
        classes: {
          root: "card card-body text-center flex-fill",
          label: "text-body-secondary small mb-1",
          value: "fs-3 fw-semibold mb-0",
          caption: "small text-body-secondary mb-0",
          trend: { up: "text-success ms-2 fs-6", down: "text-danger ms-2 fs-6", flat: "text-secondary ms-2 fs-6" },
        },
      },
      List: { classes: { root: "mb-0 ps-4" } },
      Table: { classes: { root: "table table-sm table-striped mb-0" } },
      Callout: {
        classes: {
          root: "alert mb-0",
          tone: { info: "alert-info", success: "alert-success", warning: "alert-warning", danger: "alert-danger" },
          title: "alert-heading fw-semibold mb-1",
          body: "mb-0",
        },
      },
      Badge: {
        classes: {
          // Bootstrap's badge never wraps; a long word would run out of it.
          root: "badge align-self-start text-wrap text-break text-start",
          tone: {
            neutral: "text-bg-secondary",
            info: "text-bg-info",
            success: "text-bg-success",
            warning: "text-bg-warning",
            danger: "text-bg-danger",
          },
        },
      },
      // Bootstrap styles a plain link itself, with a colour adjusted for dark
      // mode; `.link-primary` is not adjusted, and fails contrast on dark.
      Link: { classes: { root: "fw-medium" } },
    },
  });
}
