import { seeded, type Random } from "../workloads/random.ts";
import { CORPUS, PWN_HOST, type Payload } from "./corpus.ts";

/**
 * Seeded mutations of the corpus (T-441, research R7): case, character
 * encodings, whitespace and control characters, and nesting. The same seed
 * gives the same variants on any machine. The canary call and the request URL
 * are left whole, so a variant that runs or fetches still says which case it
 * was.
 */

const MARK = "FUZZID";
const PROTECTED = new RegExp(`__relaxPwned\\('${MARK}'\\)|https://${PWN_HOST.replace(/\./g, "\\.")}/${MARK}`, "g");

const WRAPPERS = ["<svg>", "<math>", "<noscript>", "<!--x-->", "<table>", "<template>"];
const INSERTS = [" ", "\t", "\n", "\r", "\f", "\u0000", "\u0001", "/", "\u00a0", "\u200b"];

type Mutation = (gap: string, r: Random) => string;

const at = (s: string, r: Random) => r.int(0, Math.max(0, s.length - 1));

const MUTATIONS: Mutation[] = [
  // Flip the case of a few letters.
  (s, r) => s.replace(/[a-z]/gi, (c) => (r.next() < 0.3 ? (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) : c)),
  // One character as a decimal or hex entity.
  (s, r) => {
    const i = at(s, r);
    const code = s.charCodeAt(i);
    if (Number.isNaN(code)) return s;
    return s.slice(0, i) + (r.next() < 0.5 ? `&#${code};` : `&#x${code.toString(16)};`) + s.slice(i + 1);
  },
  // One character percent-encoded.
  (s, r) => {
    const i = at(s, r);
    const code = s.charCodeAt(i);
    if (Number.isNaN(code) || code > 0x7f) return s;
    return s.slice(0, i) + `%${code.toString(16).padStart(2, "0")}` + s.slice(i + 1);
  },
  // Whitespace or a control character between two characters.
  (s, r) => {
    const i = at(s, r);
    return s.slice(0, i) + r.pick(INSERTS) + s.slice(i);
  },
];

function mutateGaps(text: string, r: Random): string {
  const mutation = r.pick(MUTATIONS);
  let out = "";
  let last = 0;
  for (const m of text.matchAll(PROTECTED)) {
    out += mutation(text.slice(last, m.index), r) + m[0];
    last = m.index! + m[0].length;
  }
  return out + mutation(text.slice(last), r);
}

/** `count` variants, each one to three mutations of a corpus payload. */
export function fuzzCorpus(seed: number, count: number, corpus: readonly Payload[] = CORPUS): Payload[] {
  const r = seeded(seed);
  return Array.from({ length: count }, (_, n) => {
    const base = r.pick(corpus);
    let text = base.make(MARK);
    const rounds = r.int(1, 3);
    for (let k = 0; k < rounds; k++) {
      text = r.next() < 0.15 ? r.pick(WRAPPERS) + text : mutateGaps(text, r);
    }
    const frozen = text;
    return { id: `fuzz.${seed}.${n}`, technique: base.technique, make: (id: string) => frozen.split(MARK).join(id) };
  });
}
