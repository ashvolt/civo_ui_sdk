/**
 * Outbound prompt redaction.
 *
 * Privacy-first inference removes the *provider* from the threat model; it does
 * not stop an application from pasting a customer's card number into a prompt.
 * The redactor is the last hop before the wire, and it is deliberately boring:
 * deterministic regex rules, no network, no model in the loop.
 */

export interface RedactionRule {
  /** Stable identifier reported in {@link RedactionReport.hits}. */
  id: string;
  pattern: RegExp;
  /** Replacement token. Defaults to `[redacted:<id>]`. */
  replacement?: string;
}

export interface RedactionReport {
  text: string;
  /** Rule id -> number of substitutions made. Only non-zero entries appear. */
  hits: Record<string, number>;
  get redacted(): boolean;
}

/**
 * Conservative defaults. They are intentionally high-precision: a redactor that
 * mangles ordinary prose gets switched off, and a redactor that is switched off
 * protects nobody.
 */
export const DEFAULT_REDACTION_RULES: readonly RedactionRule[] = [
  { id: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // 13-19 digits in groups, i.e. a payment card with or without separators.
  { id: "pan", pattern: /\b(?:\d[ -]?){13,19}\b/g },
  // UK National Insurance number.
  { id: "uk_nino", pattern: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g },
  // IBAN.
  { id: "iban", pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  // Bearer-ish secrets pasted into prompts.
  { id: "secret", pattern: /\b(?:sk|rlx|ghp|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/g },
];

function tokenFor(rule: RedactionRule): string {
  return rule.replacement ?? `[redacted:${rule.id}]`;
}

/** Applies `rules` to `text`, reporting which rules fired and how often. */
export function redact(
  text: string,
  rules: readonly RedactionRule[] = DEFAULT_REDACTION_RULES,
): RedactionReport {
  const hits: Record<string, number> = {};
  let out = text;

  for (const rule of rules) {
    // Clone so a caller-supplied stateful /g regex cannot leak lastIndex between calls.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    let count = 0;
    out = out.replace(re, () => {
      count += 1;
      return tokenFor(rule);
    });
    if (count > 0) hits[rule.id] = count;
  }

  return {
    text: out,
    hits,
    get redacted() {
      return Object.keys(this.hits).length > 0;
    },
  };
}
