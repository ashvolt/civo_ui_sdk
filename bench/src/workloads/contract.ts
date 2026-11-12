import { displayText, standardContract } from "relax-ui-contract";
import { z } from "zod3";

/**
 * The benchmark's contract (FR-402, data model W2): the standard twelve, with
 * Table and Chart allowed to grow far past what a real document should hold,
 * four heavy visuals added, and the document budgets raised. Used only by the
 * benchmark, so that a ladder can climb past the standard budgets to find
 * where rendering breaks.
 *
 * The standard contract itself is unchanged: `extend()` never modifies it.
 */

const tone = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.enum(values).default(fallback as never);

export const BENCH_LIMITS = { maxNodes: 200_000, maxDepth: 200 } as const;

export const benchContract = standardContract.extend(
  {
    Table: {
      description: "A table of text (benchmark: up to 20 columns and 20,000 rows).",
      role: "table",
      children: "none",
      props: z.object({
        caption: displayText(120).optional(),
        columns: z.array(displayText(60)).min(1).max(20),
        rows: z.array(z.array(displayText(120)).max(20)).max(20_000),
      }),
    },
    Chart: {
      description: "A bar or line chart (benchmark: up to 5,000 labels).",
      role: "img",
      children: "none",
      props: z.object({
        kind: tone(["bar", "line"], "bar"),
        title: displayText(80),
        unit: displayText(12).optional(),
        labels: z.array(displayText(24)).min(1).max(5_000),
        series: z
          .array(z.object({ name: displayText(40), values: z.array(z.number().finite()).max(5_000) }))
          .min(1)
          .max(4),
      }),
    },
    // The four heavy visuals (spec scenario 5), drawn by the kit (`../kit`).
    Heatmap: {
      description: "A grid of values coloured on a five-step scale (up to 500 rows by 200 columns).",
      role: "img",
      children: "none",
      props: z.object({
        title: displayText(80),
        unit: displayText(12).optional(),
        rows: z.array(displayText(24)).min(1).max(500),
        columns: z.array(displayText(24)).min(1).max(200),
        values: z.array(z.array(z.number().finite()).max(200)).max(500),
      }),
    },
    Scatter: {
      description: "Points on two numeric axes, in up to four series (up to 10,000 points each).",
      role: "img",
      children: "none",
      props: z.object({
        title: displayText(80),
        xLabel: displayText(40).optional(),
        yLabel: displayText(40).optional(),
        series: z
          .array(
            z.object({
              name: displayText(40),
              points: z.array(z.tuple([z.number().finite(), z.number().finite()])).max(10_000),
            }),
          )
          .min(1)
          .max(4),
      }),
    },
    SparklineGrid: {
      description: "A grid of small labelled line charts (up to 1,000, of up to 120 values each).",
      role: "list",
      children: "none",
      props: z.object({
        title: displayText(80).optional(),
        items: z.array(z.object({ label: displayText(40), values: z.array(z.number().finite()).max(120) })).max(1_000),
      }),
    },
    AnimatedCounter: {
      description: "A labelled number that animates in, with a live indicator; still under reduced motion.",
      role: "group",
      children: "none",
      props: z.object({
        label: displayText(40),
        value: z.number().finite(),
        unit: displayText(12).optional(),
        tone: tone(["neutral", "info", "success", "warning", "danger"], "neutral"),
      }),
    },
  },
  BENCH_LIMITS,
);

/** The bench contract's own types, drawn by the kit rather than the base theme. */
export const KIT_TYPES = ["Heatmap", "Scatter", "SparklineGrid", "AnimatedCounter"] as const;
