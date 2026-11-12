import { z } from "zod3";

/**
 * The result file, schema version 1
 * (specs/004-stress-security-benchmark/contracts/results.md). Every file the
 * runner writes is checked against this before it is written (T-406).
 */

const metric = z.object({ median: z.number(), iqr: z.number() });

export const resultSchema = z
  .object({
    schemaVersion: z.literal(1),
    budgetVersion: z.number().int().positive(),
    suite: z.enum(["smoke", "nightly", "local"]),
    environment: z.object({
      machine: z.string().min(1),
      cpu: z.string(),
      cores: z.number().int().positive(),
      memoryGb: z.number().positive(),
      os: z.string(),
      browser: z.string(),
      node: z.string(),
      commit: z.string(),
      date: z.string(),
    }),
    renderers: z.array(
      z.object({ id: z.string(), packages: z.record(z.string()), available: z.boolean(), reason: z.string().optional() }),
    ),
    workloads: z.array(
      z.object({
        id: z.string(),
        dimension: z.string(),
        seed: z.number().int(),
        steps: z.array(z.number()),
        contract: z.enum(["standard", "bench"]),
      }),
    ),
    ladders: z.array(
      z.object({
        renderer: z.string(),
        profile: z.enum(["desktop", "phone"]),
        workload: z.string(),
        expressible: z.boolean(),
        reason: z.string().optional(),
        steps: z.array(
          z.object({
            size: z.number(),
            metrics: z.record(metric),
            samples: z.unknown(),
            broken: z.string().optional(),
            detail: z.string().optional(),
          }),
        ),
        breakPoint: z.union([z.number(), z.literal("below-first-step"), z.literal("not-reached"), z.literal("not-expressible")]),
        brokenBy: z.string().optional(),
      }),
    ),
    coldStart: z
      .array(
        z.object({
          renderer: z.string(),
          profile: z.enum(["desktop", "phone"]),
          metrics: z.record(metric),
          broken: z.string().optional(),
        }),
      )
      .optional(),
    soak: z.array(z.unknown()).optional(),
    attacks: z.array(z.unknown()),
    redteam: z.array(z.unknown()).optional(),
  })
  .strict();

export type ResultFile = z.infer<typeof resultSchema>;
export type LadderEntry = ResultFile["ladders"][number];
export type ColdStartEntry = NonNullable<ResultFile["coldStart"]>[number];
