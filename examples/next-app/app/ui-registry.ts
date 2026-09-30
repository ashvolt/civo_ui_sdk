import { createUIRegistry, displayText, urlString } from "relax-ui-core";
import { z } from "zod";

/**
 * The component vocabulary this application is willing to let a model assemble.
 *
 * This file is the security boundary and the prompt, at the same time. Adding a
 * component here makes it available to the model; removing it makes the model
 * structurally incapable of emitting it. There is no third place to check.
 *
 * Note that it is imported by both the route handler (to build the schema) and
 * the client renderer (to look up implementations). One declaration, two
 * consumers, no drift.
 */
export const dashboardRegistry = createUIRegistry(
  {
    Stack: {
      description: "Vertical layout container. Use it as the root of most documents.",
      props: z.object({
        gap: z.enum(["sm", "md", "lg"]).default("md"),
        heading: displayText(120).optional().describe("Optional section heading."),
      }),
      children: "required",
    },

    Grid: {
      description: "Responsive grid. Use for a row of metrics or cards.",
      props: z.object({ columns: z.number().int().min(1).max(4).default(3) }),
      children: "required",
    },

    Metric: {
      description: "A single headline number with a label and an optional trend.",
      props: z.object({
        label: displayText(60),
        value: displayText(24).describe("Pre-formatted, e.g. '£1.2m' or '38%'."),
        trend: z.enum(["up", "down", "flat"]).optional(),
        caption: displayText(120).optional(),
      }),
    },

    Callout: {
      description: "A short, highlighted observation. Use sparingly — at most two per document.",
      props: z.object({
        tone: z.enum(["info", "success", "warning"]).default("info"),
        title: displayText(80),
        body: displayText(400),
      }),
    },

    BarList: {
      description: "A ranked list of labelled values, drawn as proportional bars.",
      props: z.object({
        title: displayText(80),
        items: z
          .array(z.object({ label: displayText(60), value: z.number().nonnegative() }))
          .min(1)
          .max(12),
      }),
    },

    Prose: {
      description: "A paragraph of explanatory text. Plain text only.",
      props: z.object({ text: displayText(1_200) }),
    },

    SourceLink: {
      description: "A link to a source. The URL must be https and on an allowed host.",
      props: z.object({
        label: displayText(80),
        // The URL guard runs at validation time, so a `javascript:` URL fails
        // the schema rather than reaching the DOM and being caught later.
        href: urlString({ schemes: ["https:"], allowedHosts: ["civo.com", "*.civo.com"] }),
      }),
    },
  },
  { maxNodes: 80, maxDepth: 6 },
);

export const dashboardSchema = dashboardRegistry.structuredSchema(
  "Dashboard",
  "A compact analytics dashboard describing the requested topic.",
);

export type DashboardRegistry = typeof dashboardRegistry;
