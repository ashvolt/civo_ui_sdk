/**
 * Getting from "what the model emitted" to "JSON text".
 *
 * Open-weight models do not hand you a bare document. DeepSeek R1 thinks out
 * loud inside `<think>`. GPT-OSS uses harmony channels. Llama wraps things in a
 * fenced code block roughly half the time, and adds "Here is the JSON you
 * asked for:" for good measure. None of that is a bug in the model — it is the
 * chat format doing its job — but every one of them breaks `JSON.parse`.
 *
 * This module is the sanitising funnel, and it is written to run repeatedly
 * over a growing buffer during streaming rather than once at the end.
 */

/** Reasoning wrappers we know how to skip. */
const REASONING_BLOCKS: readonly { open: string; close: string }[] = [
  { open: "<think>", close: "</think>" },
  { open: "<thinking>", close: "</thinking>" },
  { open: "<|channel|>analysis", close: "<|channel|>final" },
  { open: "<reasoning>", close: "</reasoning>" },
];

export interface ExtractOptions {
  /** Strip reasoning preambles. Set from the model's capability record. */
  stripReasoning?: boolean;
}

/**
 * Removes reasoning preambles.
 *
 * While a block is still open the model has not started the answer, so the
 * result is the empty string: a partial parser must not be handed prose.
 */
export function stripReasoning(raw: string): string {
  let out = raw;

  for (const { open, close } of REASONING_BLOCKS) {
    for (;;) {
      const start = out.indexOf(open);
      if (start === -1) break;
      const end = out.indexOf(close, start + open.length);
      if (end === -1) {
        // Still inside the model's reasoning: nothing to parse yet.
        return out.slice(0, start).trim();
      }
      out = out.slice(0, start) + out.slice(end + close.length);
    }
  }

  return out;
}

/** Strips markdown fences, including one the model has not closed yet. */
export function stripCodeFences(raw: string): string {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("```")) return raw;

  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) return "";

  const body = trimmed.slice(firstNewline + 1);
  const closing = body.lastIndexOf("```");
  return closing === -1 ? body : body.slice(0, closing);
}

/**
 * Returns the JSON-bearing slice of `raw`, or `""` when none has appeared yet.
 *
 * Takes everything from the first `{`/`[` onward rather than trying to find a
 * balanced span: the buffer is usually *mid-document*, so there is no balanced
 * span to find. Closing it is {@link completePartialJson}'s job.
 */
export function extractJsonText(raw: string, options: ExtractOptions = {}): string {
  let text = options.stripReasoning ? stripReasoning(raw) : raw;
  text = stripCodeFences(text);

  const brace = text.indexOf("{");
  const bracket = text.indexOf("[");
  const start =
    brace === -1 ? bracket : bracket === -1 ? brace : Math.min(brace, bracket);
  if (start === -1) return "";

  let end = text.length;
  // Trailing chatter after a closed document ("...that's the layout!") would
  // make JSON.parse fail on an otherwise perfect response.
  const lastBrace = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (lastBrace > start) {
    const tail = text.slice(lastBrace + 1).trim();
    if (tail !== "" && !tail.startsWith(",") && !tail.startsWith('"')) end = lastBrace + 1;
  }

  return text.slice(start, end);
}

/**
 * Accumulates streamed deltas and exposes the current JSON-bearing text.
 *
 * Recomputing over the whole buffer on every delta is O(n) per token and so
 * O(n^2) overall, which sounds alarming and is not: generated UI specs are
 * kilobytes, and the alternative — a resumable stateful stripper for four
 * different reasoning formats — is a great deal of subtle code to save
 * microseconds. Revisit if someone streams a megabyte.
 */
export class JsonTextAccumulator {
  private raw = "";

  constructor(private readonly options: ExtractOptions = {}) {}

  push(delta: string): void {
    if (delta) this.raw += delta;
  }

  /** Everything the model has emitted, reasoning included. For diagnostics. */
  rawText(): string {
    return this.raw;
  }

  /** The current candidate JSON text; `""` until a document begins. */
  jsonText(): string {
    return extractJsonText(this.raw, this.options);
  }
}
