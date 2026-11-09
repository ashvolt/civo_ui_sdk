import type { JsonValue, StructuringStrategyName } from "./types.js";

/**
 * Every failure the SDK raises is a `RelaxUIError`, so a caller can write one
 * `catch` and still branch precisely on `code`.
 */
export type RelaxUIErrorCode =
  | "config_invalid"
  | "sovereignty_violation"
  | "transport_error"
  | "http_error"
  | "rate_limited"
  | "payment_required"
  | "timeout"
  | "aborted"
  | "stream_malformed"
  | "no_content"
  | "truncated"
  | "schema_violation"
  | "unrepairable"
  | "capability_unsupported"
  | "guard_rejected";

export interface RelaxUIErrorOptions {
  code: RelaxUIErrorCode;
  message: string;
  /** True when retrying the identical request could plausibly succeed. */
  retryable?: boolean;
  status?: number;
  requestId?: string;
  strategy?: StructuringStrategyName;
  details?: JsonValue;
  cause?: unknown;
}

/**
 * Marks an error as the SDK's across copies of this module.
 *
 * `relax-ui-core` bundles this package rather than depending on it (core takes
 * no runtime dependency, Constitution V), so an application can hold two copies
 * of this class: core's, and the one `relax-ui-react` imports. `instanceof`
 * compares constructors, so without this an error raised in the browser would
 * fail `isRelaxUIError` imported from core. A registered symbol is the same in
 * every copy and every realm.
 */
const BRAND: unique symbol = Symbol.for("relax-ui.error") as never;

export class RelaxUIError extends Error {
  /** Lets `instanceof RelaxUIError` hold for an error made by another copy. */
  static override [Symbol.hasInstance](value: unknown): boolean {
    if (this !== RelaxUIError) return Function.prototype[Symbol.hasInstance].call(this, value);
    return typeof value === "object" && value !== null && (value as { [BRAND]?: unknown })[BRAND] === true;
  }

  readonly [BRAND] = true;
  readonly code: RelaxUIErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly requestId?: string;
  readonly strategy?: StructuringStrategyName;
  readonly details?: JsonValue;

  constructor(options: RelaxUIErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RelaxUIError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.requestId = options.requestId;
    this.strategy = options.strategy;
    this.details = options.details;
  }

  /** Safe to serialise into an HTTP response: never carries prompt content. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      status: this.status,
      requestId: this.requestId,
      strategy: this.strategy,
    };
  }
}

export function isRelaxUIError(value: unknown): value is RelaxUIError {
  return value instanceof RelaxUIError;
}
