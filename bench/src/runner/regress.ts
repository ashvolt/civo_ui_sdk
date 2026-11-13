/**
 * `pnpm bench:regress` — the pull-request regression check (T-450, FR-440):
 * compares a smoke result with the last `main` smoke result
 * (`../regress.ts` says how) and exits non-zero on a regression.
 *
 *   --baseline path.json   main's smoke result; if absent, the check is skipped
 *   --current path.json    this run's smoke result
 *
 * The report is printed, and appended to `$GITHUB_STEP_SUMMARY` when set.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { compareSmoke, reportMarkdown } from "../regress.ts";
import { resultSchema } from "../results.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const baselinePath = arg("baseline");
const currentPath = arg("current");
if (!currentPath) {
  console.error("usage: regress --baseline main.json --current smoke.json");
  process.exit(2);
}
const summary = process.env.GITHUB_STEP_SUMMARY;
const read = (p: string) => resultSchema.parse(JSON.parse(readFileSync(p, "utf8")));

if (!baselinePath || !existsSync(baselinePath)) {
  const note = "### Bench smoke: no baseline from main yet; regression check skipped\n";
  console.log(note);
  if (summary) appendFileSync(summary, note);
  process.exit(0);
}

const report = compareSmoke(read(baselinePath), read(currentPath));
const md = reportMarkdown(report);
console.log(md);
if (summary) appendFileSync(summary, md);
process.exit(report.regressed ? 1 : 0);
