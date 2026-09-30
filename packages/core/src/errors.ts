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

export class RelaxUIError extends Error {
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
