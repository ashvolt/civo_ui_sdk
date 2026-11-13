/**
 * The disclosure gate (T-445, FR-435, research R13, invariant A3): a
 * contender found to execute an attack is not named in anything committed
 * until its maintainers have been told privately and have had 30 days.
 *
 * Every result of such a contender, clean ones too, goes to the private part:
 * a committed file that kept its clean cases and dropped the rest would name it
 * by the gap. The public part leaves the contender out and says only how many
 * contenders were withheld. This SDK's results are never withheld.
 *
 * One kind of finding is not withheld: a bad URL on the kit's own Link and
 * nothing else. The contenders hand props to the application's components
 * unchecked, by design (none checks a prop while drawing); the kit, standing
 * in for the application, has no URL guard (FR-430). Such a result is the
 * same for every contender and says how the library is built, not that its
 * own safety failed. It stays `executed`, with `cause` saying why it is
 * published. A link the library draws itself, or any other evidence, is
 * the library's own and is withheld.
 */

export const EMBARGO_DAYS = 30;

/** How the DOM scan names a bad URL on the kit's Link (`../attacks/page.ts`). */
const KIT_LINK_URL = /^url kit-link /;

export const PASSED_THROUGH = "passed-through-unchecked";

/** Whether the only evidence is a bad URL on the kit's own Link. */
export function passedThrough(evidence: Record<string, readonly string[] | undefined> | undefined): boolean {
  const entries = Object.entries(evidence ?? {}).filter(([, v]) => v && v.length);
  return entries.length > 0 && entries.every(([kind, v]) => kind === "dom" && v!.every((e) => KIT_LINK_URL.test(e)));
}

export interface Gated<R> {
  /** For the committed result file. */
  published: (R & { cause?: string })[];
  /** For `bench/results/private/`, untracked; empty when nothing is embargoed. */
  embargoed: (R & { embargoed: true })[];
  /** How many contenders were withheld; their names are in the private part only. */
  withheld: number;
  /** The first day the withheld results may be published, if any were. */
  until?: string;
}

export function disclosureGate<R extends { renderer: string; outcome: string; evidence?: Record<string, readonly string[] | undefined> }>(
  results: readonly R[],
  isContender: (renderer: string) => boolean,
  today: Date = new Date(),
): Gated<R> {
  const own = (r: R) => isContender(r.renderer) && r.outcome === "executed";
  const hidden = new Set(results.filter((r) => own(r) && !passedThrough(r.evidence)).map((r) => r.renderer));
  const published = results
    .filter((r) => !hidden.has(r.renderer))
    .map((r) => (own(r) ? { ...r, cause: PASSED_THROUGH } : r));
  const embargoed = results.filter((r) => hidden.has(r.renderer)).map((r) => ({ ...r, embargoed: true as const }));
  if (!hidden.size) return { published, embargoed, withheld: 0 };
  const until = new Date(today.getTime() + EMBARGO_DAYS * 86_400_000).toISOString().slice(0, 10);
  return { published, embargoed, withheld: hidden.size, until };
}
