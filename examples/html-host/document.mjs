/**
 * The document every section of the example renders: one of each kind of
 * component, so each theme library shows everything it maps — and Chart, which
 * neither Bootstrap nor Shoelace has, shows the base-theme fallback.
 */
const n = (type, props, children, key) => ({ type, ...(key ? { key } : {}), props, ...(children ? { children } : {}) });

export const DOCUMENT = {
  root: n("Stack", { gap: "md" }, [
    n("Heading", { text: "UK public cloud spend", level: 2 }, undefined, "h"),
    n("Text", { text: "Illustrative figures, streamed by a local stand-in endpoint.", tone: "muted" }, undefined, "t"),
    n(
      "Grid",
      { columns: 3 },
      [
        n("Metric", { label: "Total spend", value: "£4.1bn", trend: "up", caption: "vs £3.6bn last year" }, undefined, "m1"),
        n("Metric", { label: "Growth", value: "18%", trend: "up" }, undefined, "m2"),
        n("Metric", { label: "Providers", value: "41", trend: "flat" }, undefined, "m3"),
      ],
      "g",
    ),
    n("Callout", { tone: "warning", title: "Heads up", body: "Q3 includes a one-off migration." }, undefined, "c"),
    n(
      "Card",
      { title: "By region", subtitle: "Spend and change" },
      [
        n("Table", { columns: ["Region", "Spend", "Change"], rows: [["UK", "£1.2m", "+8%"], ["IE", "£0.4m", "-2%"]] }),
        n("Stack", { direction: "row", gap: "sm" }, [n("Badge", { text: "beta", tone: "info" }), n("Badge", { text: "verified", tone: "success" })]),
      ],
      "card",
    ),
    n("Chart", { kind: "bar", title: "Spend by quarter", unit: "£m", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "UK", values: [12, 18, 9, 21] }] }, undefined, "ch"),
    n("List", { items: ["Consolidate regions", "Renegotiate egress"], ordered: true }, undefined, "l"),
    n("Link", { label: "Methodology", href: "https://example.com/methodology" }, undefined, "a"),
  ]),
};
