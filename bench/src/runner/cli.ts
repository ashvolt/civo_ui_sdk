/**
 * `pnpm bench` — climbs the ladders and writes a result file.
 *
 *   --suite smoke|nightly|local   smoke: ours-element, first 3 steps, 3 repetitions, desktop
 *   --renderer ours-element,…     default: every renderer with a page
 *   --workload nodes,…            default: every ladder
 *   --profile desktop,phone       default: both (smoke: desktop)
 *   --reps N                      default: 5 (smoke: 3)
 *   --out path.json               default: bench/results/<suite>-<date>.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { BUDGET_VERSION } from "../budgets.ts";
import { resultSchema, type ResultFile } from "../results.ts";
import { countNodes, depthOf, documentFor } from "../workloads/generator.ts";
import { contractFor, LADDERS, planStep } from "../workloads/ladders.ts";
import { environment } from "./environment.ts";
import { RENDERERS } from "./renderers.ts";
import { climb, coldStart } from "./ladder.ts";
import { startServer } from "./server.ts";
import type { ProfileId } from "./step.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");


function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const list = (name: string) => arg(name)?.split(",").filter(Boolean);

const suite = (arg("suite") ?? "local") as ResultFile["suite"];
const smoke = suite === "smoke";
// The pull-request run measures this SDK's element only (plan D6).
const renderers = list("renderer") ?? (smoke ? ["ours-element"] : Object.keys(RENDERERS).filter((id) => RENDERERS[id]!.ladders !== false));
const ladders = LADDERS.filter((l) => !list("workload") || list("workload")!.includes(l.id));
const profiles = (list("profile") ?? (smoke ? ["desktop"] : ["desktop", "phone"])) as ProfileId[];
const reps = Number(arg("reps") ?? (smoke ? 3 : 5));

const server = await startServer(join(root, "dist"));
const browser = await chromium.launch();
const result: ResultFile = {
  schemaVersion: 1,
  budgetVersion: BUDGET_VERSION,
  suite,
  environment: environment(browser),
  renderers: renderers.map((id) => ({ id, packages: RENDERERS[id]?.packages ?? {}, available: id in RENDERERS })),
  workloads: ladders.map((l) => {
    const largest = documentFor(planStep(l, l.steps.at(-1)!));
    return { id: l.id, dimension: l.id, seed: l.seed, steps: l.steps, contract: contractFor(countNodes(largest.root), depthOf(largest.root)) };
  }),
  ladders: [],
  coldStart: [],
  attacks: [],
};

try {
  for (const renderer of renderers) {
    const r = RENDERERS[renderer];
    if (!r) {
      console.error(`unknown renderer ${renderer}`);
      continue;
    }
    for (const profile of profiles) {
      result.coldStart!.push(
        await coldStart(browser, server, { renderer, page: r.page, profile, reps, ...(r.encode ? { encode: r.encode } : {}), log: (line) => console.log(line) }),
      );
      for (const ladder of ladders) {
        result.ladders.push(
          await climb(browser, server, ladder, {
            renderer,
            page: r.page,
            profile,
            reps,
            ...(smoke ? { maxSteps: 3 } : {}),
            ...(r.encode ? { encode: r.encode } : {}),
            log: (line) => console.log(line),
          }),
        );
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const checked = resultSchema.parse(result);
const out = arg("out") ?? join(root, "results", `${suite}-${checked.environment.date.slice(0, 10)}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(checked, null, 1)}\n`);
console.log(`\nwrote ${out}`);
for (const c of checked.coldStart ?? []) {
  console.log(`${c.renderer.padEnd(14)} ${c.profile.padEnd(8)} cold start     first node ${Math.round(c.metrics.firstNode!.median)} ms, longest task ${c.metrics.longestTask!.median} ms`);
}
for (const l of checked.ladders) {
  console.log(`${l.renderer.padEnd(14)} ${l.profile.padEnd(8)} ${l.workload.padEnd(14)} break point: ${l.breakPoint}${l.brokenBy ? ` (${l.brokenBy})` : ""}`);
}
