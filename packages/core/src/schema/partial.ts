import type { JsonValue } from "../types.js";

/**
 * Streaming-tolerant Zod validation.
 *
 * Halfway through a stream the object is *supposed* to be incomplete: required
 * keys have not arrived, a string is three characters long, an enum member is
 * still being spelled. Running the caller's schema unchanged would reject every
 * frame until the last one, which defeats the purpose of streaming.
 *
 * The obvious fix — deriving a deep-partial schema — means walking Zod's
 * internals and rebuilding the tree, which breaks on every refinement,
 * transform and branded type, and differs between Zod majors. So we invert it:
 * run the real schema, then classify the issues. An issue that only says
 * "not finished yet" is tolerated while the stream is open and fatal once it
 * closes. An issue that says "this is the wrong shape" is fatal immediately,
 * which is what lets a bad generation fail fast instead of at the last token.
 */

export interface ZodIssueLike {
  code?: string;
  path?: (string | number)[];
  message?: string;
  received?: unknown;
  expected?: unknown;
  input?: unknown;
  keys?: string[];
}

export interface ZodSafeParseLike<T> {
  success: boolean;
  data?: T;
  error?: { issues?: ZodIssueLike[] };
}

export interface SchemaLike<T> {
  safeParse: (data: unknown) => ZodSafeParseLike<T>;
}

export interface PartialValidationResult<T> {
  /** `ok` once the value satisfies the schema outright. */
  status: "ok" | "incomplete" | "invalid";
  data?: T;
  /** Only the issues that are fatal even mid-stream. */
  fatalIssues: ZodIssueLike[];
  /** Issues that merely mean "the model has not written this yet". */
  pendingIssues: ZodIssueLike[];
}

/**
 * Issue codes that describe an unfinished value rather than a wrong one.
 * Covers both Zod 3 and Zod 4 spellings.
 */
const PENDING_CODES = new Set([
  "too_small",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_literal",
  "invalid_enum_value",
  "invalid_value",
  "invalid_string",
  "invalid_format",
  "not_multiple_of",
  "custom",
]);

/** Codes that always mean the generation went wrong, however early we are. */
const FATAL_CODES = new Set(["unrecognized_keys", "too_big", "invalid_date", "not_finite"]);

function isMissingValue(issue: ZodIssueLike): boolean {
  if (issue.code !== "invalid_type") return false;
  // Zod 3 reports `received: "undefined"`; Zod 4 reports `input: undefined`.
  if (issue.received === "undefined" || issue.received === "null") return true;
  return "input" in issue && issue.input === undefined;
}

export function classifyIssue(issue: ZodIssueLike): "pending" | "fatal" {
  if (isMissingValue(issue)) return "pending";
  if (issue.code && FATAL_CODES.has(issue.code)) return "fatal";
  if (issue.code && PENDING_CODES.has(issue.code)) return "pending";
  return "fatal";
}

/**
 * Validates `value` against `schema` under streaming rules.
 *
 * @param finished - when true, pending issues are promoted to fatal: the stream
 *   is over, so "not finished yet" is simply "wrong".
 */
export function safeParsePartial<T>(
  schema: SchemaLike<T>,
  value: unknown,
  finished = false,
): PartialValidationResult<T> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { status: "ok", data: result.data as T, fatalIssues: [], pendingIssues: [] };
  }

  const issues = result.error?.issues ?? [];
  const fatalIssues: ZodIssueLike[] = [];
  const pendingIssues: ZodIssueLike[] = [];

  for (const issue of issues) {
    if (classifyIssue(issue) === "fatal") fatalIssues.push(issue);
    else pendingIssues.push(issue);
  }

  if (finished || fatalIssues.length > 0) {
    return {
      status: "invalid",
      fatalIssues: finished ? [...fatalIssues, ...pendingIssues] : fatalIssues,
      pendingIssues: finished ? [] : pendingIssues,
    };
  }

  return { status: "incomplete", fatalIssues: [], pendingIssues };
}

/** Renders issues into the compact, model-readable form used by repair prompts. */
export function formatIssues(issues: readonly ZodIssueLike[], limit = 12): string {
  return issues
    .slice(0, limit)
    .map((issue) => {
      const path = (issue.path ?? []).join(".") || "<root>";
      return `- ${path}: ${issue.message ?? issue.code ?? "invalid"}`;
    })
    .join("\n");
}

/** Strips issue payloads down to something safe to log: no user data. */
export function redactIssues(issues: readonly ZodIssueLike[]): JsonValue {
  return issues.map((issue) => ({
    code: issue.code ?? null,
    path: (issue.path ?? []).map(String).join("."),
  })) as unknown as JsonValue;
}
