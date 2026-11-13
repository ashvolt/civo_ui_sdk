import type { Mounted } from "../probe/page.ts";
import type { AttackMount, AttackSetup, Settled } from "./page.ts";

/**
 * One attack case through a contender's page (T-445): the same corpus, encoded
 * by the runner in the contender's own wire format, fed through the page's
 * ordinary `mount`, as a step of the ladders is. A contender has no validation
 * tiers and reports no refusals of its own; it either finishes or fails.
 *
 * The scans read the whole host: what the contender draws around the document
 * is its own, and is in the benign baseline too.
 */
export interface ContenderSource {
  chunks: string[];
}

export function attackFromMount(mount: (host: HTMLElement) => Promise<Mounted>): (host: HTMLElement, setup: AttackSetup) => Promise<AttackMount> {
  return async (host, setup) => {
    const { chunks } = setup.source as ContenderSource;
    const m = await mount(host);
    const settled = (async (): Promise<Settled> => {
      try {
        for (const chunk of chunks) m.push(chunk);
        m.end();
        await m.done();
        return { status: "complete", refused: 0 };
      } catch (e) {
        return { status: "error", refused: 0, errorCode: String((e as Error)?.message ?? e).slice(0, 120) };
      }
    })();
    return {
      settled: () => settled,
      surface: () => host,
      unmount: () => m.unmount(),
    };
  };
}
