import type { ResultFile } from "./results.ts";

/**
 * Merging the nightly run's parallel jobs (T-451): one renderer's ladders,
 * one soak or one host's attacks each, into one file per kind.
 */

/** The ladder files of one run, merged; per-run samples dropped, every median and spread kept. */
export function mergeLadders(parts: readonly ResultFile[]): ResultFile {
  const first = parts[0]!;
  return {
    ...first,
    suite: "nightly",
    renderers: parts.flatMap((p) => p.renderers),
    ladders: parts.flatMap((p) => p.ladders.map((l) => ({ ...l, steps: l.steps.map((s) => ({ ...s, samples: [] })) }))),
    coldStart: parts.flatMap((p) => p.coldStart ?? []),
    attacks: [],
  };
}

/** The soak files of one run, merged. */
export function mergeSoaks(parts: readonly ResultFile[]): ResultFile {
  return { ...parts[0]!, suite: "nightly", renderers: parts.flatMap((s) => s.renderers), soak: parts.flatMap((s) => s.soak ?? []) };
}

export interface AttackFile {
  schemaVersion: number;
  environment: unknown;
  fuzz?: unknown;
  notExpressible?: unknown[];
  withheld?: { contenders: number; until: string; why: string };
  attacks: unknown[];
}

/** The attack files of one run, merged. A contender withheld by a job's gate stays withheld, by count only (FR-435). */
export function mergeAttacks(parts: readonly AttackFile[]): AttackFile {
  const withheld = parts.map((p) => p.withheld).filter((w): w is NonNullable<AttackFile["withheld"]> => !!w);
  const notExpressible = parts.flatMap((p) => p.notExpressible ?? []);
  return {
    schemaVersion: parts[0]!.schemaVersion,
    environment: parts[0]!.environment,
    ...(parts[0]!.fuzz ? { fuzz: parts[0]!.fuzz } : {}),
    ...(notExpressible.length ? { notExpressible } : {}),
    ...(withheld.length
      ? { withheld: { contenders: withheld.reduce((n, w) => n + w.contenders, 0), until: withheld.map((w) => w.until).sort().at(-1)!, why: withheld[0]!.why } }
      : {}),
    attacks: parts.flatMap((p) => p.attacks),
  };
}
