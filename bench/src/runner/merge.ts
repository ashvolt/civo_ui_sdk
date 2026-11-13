/**
 * `pnpm bench:merge` — the nightly run's last step (T-451): the result files
 * of the parallel jobs merged into one file per kind (`../merge.ts`), as the
 * dashboard reads them.
 *
 *   --in dir      where the jobs' files were downloaded (searched recursively):
 *                 ladders-*.json, soak-*.json, attacks-*.json
 *   --out dir     default: bench/results/nightly
 *
 * The previous nightly files in `--out` are replaced: the history is in git.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeAttacks, mergeLadders, mergeSoaks, type AttackFile } from "../merge.ts";
import { resultSchema } from "../results.ts";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".json") ? [p] : [];
  });
}

const input = arg("in");
if (!input) {
  console.error("usage: merge --in dir [--out dir]");
  process.exit(2);
}
const out = arg("out") ?? join(here, "..", "..", "results", "nightly");
const all = files(input);
const of = (kind: string) => all.filter((f) => basename(f).startsWith(`${kind}-`)).map((f) => JSON.parse(readFileSync(f, "utf8")) as unknown);
const ladders = of("ladders").map((x) => resultSchema.parse(x));
const soaks = of("soak").map((x) => resultSchema.parse(x));
const attacks = of("attacks") as AttackFile[];
if (!ladders.length && !soaks.length && !attacks.length) {
  console.error(`no result files in ${input}`);
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith(".json")) rmSync(join(out, f));
const write = (name: string, value: unknown) => {
  writeFileSync(join(out, name), JSON.stringify(value, null, 1) + "\n");
  console.log(`wrote ${join(out, name)}`);
};
if (ladders.length) write(`compare-${date}.json`, resultSchema.parse(mergeLadders(ladders)));
if (soaks.length) write(`soak-${date}.json`, resultSchema.parse(mergeSoaks(soaks)));
if (attacks.length) write(`attacks-${date}.json`, mergeAttacks(attacks));
