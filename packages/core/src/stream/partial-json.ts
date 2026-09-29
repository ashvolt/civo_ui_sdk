import type { JsonValue } from "../types.js";

/**
 * Incremental JSON completion.
 *
 * A model streams `{"title":"Quarterly rev` and a UI wants to paint the title
 * *now*, not when the closing brace arrives. `JSON.parse` cannot help: the text
 * is not a document yet. So we do the next best thing — find the longest prefix
 * that is still salvageable, discard the half-emitted member at the tail, and
 * synthesise the closers the document is missing.
 *
 * The rules that matter:
 *   - a half-written **value** string is kept and closed (`"Quarterly rev"`),
 *     because partially rendered prose is the point of streaming;
 *   - a half-written **key** is discarded, because `{"tit": ...}` would be a
 *     lie about the shape of the object;
 *   - a dangling `,` `:` or incomplete literal/number is rewound to the last
 *     committed member of its frame.
 *
 * The scanner is single-pass and allocation-light: it is on the hot path for
 * every token the model emits.
 */

export type PartialParseState = "complete" | "partial" | "empty" | "invalid";

export interface PartialParseResult {
  state: PartialParseState;
  /** Present for `complete` and `partial`. */
  value?: JsonValue;
  /** The repaired JSON text that produced `value`. Useful in tests and traces. */
  text?: string;
}

type FrameKind = "root" | "object" | "array";
type Expect = "value" | "key" | "colon" | "comma";

interface Frame {
  kind: FrameKind;
  /** Index in the source just past the last complete member of this frame. */
  commit: number;
  expect: Expect;
}

const LITERALS = ["true", "false", "null"] as const;

/**
 * Repairs `src` into parseable JSON, or returns `null` when nothing usable has
 * arrived yet. Exported for tests and for callers that want the text rather
 * than the value.
 */
export function completePartialJson(src: string): string | null {
  const stack: Frame[] = [{ kind: "root", commit: 0, expect: "value" }];

  let i = 0;
  let inString = false;
  let stringIsKey = false;
  let escaped = false;
  let tokenStart = -1; // start of a bare number/literal currently being scanned
  let sawStructuralError = false;

  const top = (): Frame => stack[stack.length - 1] as Frame;

  const completeValue = (end: number): void => {
    const frame = top();
    frame.commit = end;
    frame.expect = "comma";
  };

  const finishBareToken = (end: number): void => {
    if (tokenStart === -1) return;
    const raw = src.slice(tokenStart, end);
    tokenStart = -1;
    if (isCompleteBareToken(raw)) completeValue(end);
    else sawStructuralError = true;
  };

  for (; i < src.length; i++) {
    const ch = src[i] as string;

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') {
        inString = false;
        if (stringIsKey) top().expect = "colon";
        else completeValue(i + 1);
      }
      continue;
    }

    if (tokenStart !== -1 && !isBareTokenChar(ch)) {
      finishBareToken(i);
    }

    switch (ch) {
      case " ":
      case "\t":
      case "\n":
      case "\r":
        continue;
      case '"': {
        const frame = top();
        if (frame.expect === "key") {
          inString = true;
          stringIsKey = true;
        } else if (frame.expect === "value") {
          inString = true;
          stringIsKey = false;
        } else {
          sawStructuralError = true;
        }
        continue;
      }
      case "{":
      case "[": {
        const frame = top();
        if (frame.expect !== "value") {
          sawStructuralError = true;
          continue;
        }
        const kind: FrameKind = ch === "{" ? "object" : "array";
        stack.push({ kind, commit: i + 1, expect: kind === "object" ? "key" : "value" });
        continue;
      }
      case "}":
      case "]": {
        const frame = top();
        const wanted: FrameKind = ch === "}" ? "object" : "array";
        if (frame.kind !== wanted) {
          sawStructuralError = true;
          continue;
        }
        stack.pop();
        completeValue(i + 1);
        continue;
      }
      case ",": {
        const frame = top();
        if (frame.expect !== "comma") {
          sawStructuralError = true;
          continue;
        }
        frame.expect = frame.kind === "object" ? "key" : "value";
        continue;
      }
      case ":": {
        const frame = top();
        if (frame.expect !== "colon") {
          sawStructuralError = true;
          continue;
        }
        frame.expect = "value";
        continue;
      }
      default: {
        const frame = top();
        if (frame.expect !== "value") {
          sawStructuralError = true;
          continue;
        }
        if (tokenStart === -1) tokenStart = i;
        continue;
      }
    }
  }

  if (sawStructuralError) return null;

  // --- End of buffer: decide how much of the tail survives. -----------------
  let cut: number;
  let closeOpenString = false;

  if (inString) {
    if (stringIsKey) {
      cut = top().commit;
    } else {
      cut = trimDanglingEscape(src, src.length);
      closeOpenString = true;
    }
  } else {
    if (tokenStart !== -1) {
      const raw = src.slice(tokenStart);
      cut = isCompleteBareToken(raw) ? src.length : top().commit;
    } else {
      cut = top().commit;
    }
  }

  let out = src.slice(0, cut);
  if (closeOpenString) out += '"';

  // Close every open frame, innermost first.
  for (let d = stack.length - 1; d >= 1; d--) {
    out += (stack[d] as Frame).kind === "object" ? "}" : "]";
  }

  return out.trim() === "" ? null : out;
}

/** Parses whatever of `src` is usable. Never throws. */
export function parsePartialJson(src: string): PartialParseResult {
  if (src.trim() === "") return { state: "empty" };

  // Fast path: the common case at end-of-stream is a complete document.
  try {
    return { state: "complete", value: JSON.parse(src) as JsonValue, text: src };
  } catch {
    // fall through to repair
  }

  const repaired = completePartialJson(src);
  if (repaired === null) return { state: "invalid" };

  try {
    return { state: "partial", value: JSON.parse(repaired) as JsonValue, text: repaired };
  } catch {
    return { state: "invalid" };
  }
}

function isBareTokenChar(ch: string): boolean {
  return /[-+0-9a-zA-Z.eE]/.test(ch);
}

function isCompleteBareToken(raw: string): boolean {
  if (LITERALS.includes(raw as (typeof LITERALS)[number])) return true;
  // A number is only safe to keep if it terminates on a digit: `1.2e` and `-`
  // are prefixes of numbers the model has not finished writing.
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw);
}

/**
 * Rewinds past a partially emitted escape sequence at the end of a string so
 * that appending `"` yields valid JSON: `"a\` and `"a\u00` are both traps.
 */
function trimDanglingEscape(src: string, end: number): number {
  let backslashes = 0;
  let j = end - 1;
  while (j >= 0 && src[j] === "\\") {
    backslashes++;
    j--;
  }
  if (backslashes % 2 === 1) return end - 1;

  // Incomplete \uXXXX.
  const window = src.slice(Math.max(0, end - 6), end);
  const u = window.lastIndexOf("\\u");
  if (u !== -1) {
    const digits = window.slice(u + 2);
    if (digits.length < 4 && /^[0-9a-fA-F]*$/.test(digits)) {
      return end - (digits.length + 2);
    }
  }
  return end;
}
