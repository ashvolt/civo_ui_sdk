import { z } from "zod";
import { defineContract } from "./contract.js";
import { displayText, urlString } from "./fields.js";

/**
 * The twelve standard components (FR-210, research R11).
 *
 * Chosen to render well through every connector kind: plain HTML with classes,
 * Web Components, and framework components. Read-only by construction — no
 * component can execute anything, and Link only navigates (FR-213).
 *
 * Every string a model writes is `displayText` (bounded, no control
 * characters), every list is bounded, and unknown props are dropped rather
 * than passed on. Descriptions are written for the model: they are the prompt.
 */

const tone = <T extends [string, ...string[]]>(values: T, fallback: T[number]) => z.enum(values).default(fallback);

export const STANDARD_COMPONENTS = {
  Stack: {
    description:
      "Lays its children out in a single column (or a row). Use it as the root of most documents and to group related content.",
    role: "group",
    children: "required",
    props: z.object({
      gap: tone(["sm", "md", "lg"], "md").describe("Space between children."),
      direction: tone(["column", "row"], "column"),
    }),
  },

  Grid: {
    description: "A responsive grid of equal columns. Use for a row of Metrics or Cards.",
    role: "group",
    children: "required",
    props: z.object({
      columns: z.number().int().min(1).max(4).default(3).describe("Columns on a wide screen; fewer on a narrow one."),
    }),
  },

  Card: {
    description: "A bordered panel with an optional title, grouping a few related children.",
    role: "region",
    children: "optional",
    props: z.object({
      title: displayText(120).optional(),
      subtitle: displayText(200).optional(),
    }),
  },

  Heading: {
    description: "A section heading. Level 1 at most once per document.",
    role: "heading",
    children: "none",
    props: z.object({
      text: displayText(160),
      level: z.number().int().min(1).max(4).default(2),
    }),
  },

  Text: {
    description: "A paragraph of plain text. No markup: it is shown exactly as written.",
    role: "paragraph",
    children: "none",
    props: z.object({
      text: displayText(2_000),
      tone: tone(["default", "muted"], "default"),
    }),
  },

  Metric: {
    description:
      "One headline figure. `value` is only the figure with its unit (e.g. '£1.2m', '38%'), never a sentence; what it means goes in `label`, any comparison in `caption`.",
    role: "group",
    children: "none",
    props: z.object({
      label: displayText(60),
      value: displayText(24),
      trend: z.enum(["up", "down", "flat"]).optional(),
      caption: displayText(160).optional(),
    }),
  },

  List: {
    description: "A short bulleted or numbered list of plain-text items.",
    role: "list",
    children: "none",
    props: z.object({
      items: z.array(displayText(200)).min(1).max(20),
      ordered: z.boolean().default(false),
    }),
  },

  Table: {
    description: "A small table of text. Every row has one cell per column, in column order.",
    role: "table",
    children: "none",
    props: z.object({
      caption: displayText(120).optional(),
      columns: z.array(displayText(60)).min(1).max(8),
      rows: z.array(z.array(displayText(120)).max(8)).max(50),
    }),
  },

  Callout: {
    description: "A short highlighted observation. Use sparingly — at most two per document.",
    role: "note",
    children: "none",
    props: z.object({
      tone: tone(["info", "success", "warning", "danger"], "info"),
      title: displayText(80),
      body: displayText(400),
    }),
  },

  Badge: {
    description: "A one- or two-word status label.",
    role: "note",
    children: "none",
    props: z.object({
      text: displayText(32),
      tone: tone(["neutral", "info", "success", "warning", "danger"], "neutral"),
    }),
  },

  Link: {
    description: "A link to a source or further reading. https, a site-relative path, or mailto only.",
    role: "link",
    children: "none",
    props: z.object({
      label: displayText(80),
      // The guard runs at validation time, so `javascript:` fails the schema
      // rather than reaching the DOM.
      href: urlString({ schemes: ["https:", "mailto:"] }),
    }),
  },

  Chart: {
    description:
      "A bar or line chart. `labels` name the points; each series has one value per label, in the same order.",
    role: "img",
    children: "none",
    props: z.object({
      kind: tone(["bar", "line"], "bar"),
      title: displayText(80),
      unit: displayText(12).optional().describe("Shown after values, e.g. '%' or '£m'."),
      labels: z.array(displayText(24)).min(1).max(24),
      series: z
        .array(
          z.object({
            name: displayText(40),
            values: z.array(z.number().finite()).max(24),
          }),
        )
        .min(1)
        .max(4),
    }),
  },
} as const;

export type StandardComponentName = keyof typeof STANDARD_COMPONENTS;

export const STANDARD_COMPONENT_NAMES = Object.freeze(Object.keys(STANDARD_COMPONENTS)) as readonly StandardComponentName[];

/** The standard contract, with feature 001's document budget. */
export const standardContract = defineContract(STANDARD_COMPONENTS);

/** Props of each standard component, after defaults are applied. */
export type StandardProps = {
  [K in StandardComponentName]: z.output<(typeof STANDARD_COMPONENTS)[K]["props"]>;
};
