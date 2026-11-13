/**
 * Attack outcomes from evidence (plan D7, contracts/attacks.md, data model
 * §8). The outcome is decided by rule, never by eye: any evidence of
 * execution is "executed"; otherwise a renderer that reported a refusal
 * "blocked" the case, and one that drew it "inert" (invariant A2).
 */

export type Outcome = "blocked" | "inert" | "executed";

/** What the page and the browser saw while one case ran. */
export interface Evidence {
  /** Ids passed to `window.__relaxPwned`: script ran. */
  canary: string[];
  /** Content-Security-Policy violations (report-only: the page still ran it). */
  policy: string[];
  /** Elements, attributes or URLs in the rendered DOM that the benign document never draws. */
  dom: string[];
  /** Requests that left the page's origin. */
  requests: string[];
  /** Built-in prototypes, globals or the renderer's own objects that changed. */
  globals: string[];
  /** Generated elements drawn outside the host's box. */
  bounds: string[];
}

export const EVIDENCE_KINDS = ["canary", "policy", "dom", "requests", "globals", "bounds"] as const satisfies readonly (keyof Evidence)[];

export const noEvidence = (): Evidence => ({ canary: [], policy: [], dom: [], requests: [], globals: [], bounds: [] });

/** Which kinds of evidence a case produced. */
export function evidenceKinds(e: Evidence): (keyof Evidence)[] {
  return EVIDENCE_KINDS.filter((k) => e[k].length > 0);
}

export function classify(evidence: Evidence, refused: boolean): Outcome {
  if (evidenceKinds(evidence).length > 0) return "executed";
  return refused ? "blocked" : "inert";
}
