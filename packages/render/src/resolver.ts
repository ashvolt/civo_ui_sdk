import { RelaxUIError } from "relax-ui-protocol";
import type { Catalog } from "./catalog.js";

/**
 * The render core: what to do with one node, independent of how it is drawn.
 *
 * Every renderer — the DOM backend, React, the Web Component — asks the same
 * questions in the same order, so they cannot disagree about what a document
 * shows:
 *
 * 1. Too deep? Not a contract type? → not rendered.
 * 2. An exact contract type → start loading its code now, before its props
 *    have finished streaming (FR-241).
 * 3. Validation `full` → the validator must have loaded, and the props must
 *    pass it; only parsed props reach an implementation (FR-206, data model
 *    I1). Validation `server` → the validator is never loaded (FR-208).
 * 4. Implementation arrived → render. Loading → placeholder. Failed → not
 *    rendered, and reported (FR-244).
 */

export interface Validator {
  props(type: string, raw: unknown): { ok: true; props: Record<string, unknown> } | { ok: false; detail?: string };
}

/** A validator, or a loader for one, so its code (Zod) can stay out of the bundle. */
export type ValidatorSource = Validator | (() => Promise<Validator>);

/**
 * Why a node was not rendered — or, for `fallback` and `override`, a notice:
 * the base theme drew a type a connector does not implement (K1), or a later
 * connector took a type from an earlier one (K4).
 */
export type RenderReason = "unknown_type" | "invalid_props" | "load_failed" | "depth_exceeded" | "fallback" | "override";

export interface RenderReport {
  reason: RenderReason;
  type: string;
  detail?: string;
}

export interface ResolverOptions<I> {
  catalog: Catalog<I>;
  /** The contract's component names. Only these are ever loaded or rendered. */
  types: readonly string[];
  /** Default `full`. `server` only for a same-origin route (see `resolveValidation`). */
  validate?: "full" | "server";
  /** Required for `full`. Loaded on the first node, never for `server`. */
  validator?: ValidatorSource;
  /** Default 24, feature 001's limit. */
  maxDepth?: number;
  /**
   * Called once per reason and type per document. Unknown types and invalid
   * props are reported only when the document is complete: mid-stream, a type
   * still being written and props not yet finished are not faults.
   */
  onReport?: (report: RenderReport) => void;
  /**
   * Types drawn by the base theme although connectors are attached. Reported
   * once per type per document, when one is first rendered (FR-237).
   */
  fallbacks?: ReadonlySet<string>;
}

export type Resolution<I> =
  | { kind: "render"; implementation: I; props: Record<string, unknown> }
  /** Waiting for the implementation's code or for the validator. */
  | { kind: "pending" }
  /** Not rendered. `failure` says why, for a renderer that shows a fallback. */
  | { kind: "skip"; failure: RenderReport };

export class Resolver<I> {
  readonly catalog: Catalog<I>;
  readonly maxDepth: number;
  readonly tier: "full" | "server";
  private readonly types: ReadonlySet<string>;
  private readonly onReport: ((report: RenderReport) => void) | undefined;
  private readonly fallbacks: ReadonlySet<string>;
  private validator: Validator | undefined;
  private validatorLoader: (() => Promise<Validator>) | undefined;
  private validatorState: "idle" | "loading" | "ready" | "failed" = "idle";
  private readonly reported = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(options: ResolverOptions<I>) {
    this.catalog = options.catalog;
    this.types = new Set(options.types);
    this.maxDepth = options.maxDepth ?? 24;
    this.tier = options.validate ?? "full";
    this.onReport = options.onReport;
    this.fallbacks = options.fallbacks ?? new Set();

    if (this.tier !== "full" && this.tier !== "server") {
      throw new RelaxUIError({ code: "config_invalid", message: `Unknown validation tier "${String(this.tier)}".` });
    }
    if (this.tier === "full") {
      const source = options.validator;
      if (source === undefined) {
        throw new RelaxUIError({
          code: "config_invalid",
          message: 'Validation "full" needs a validator (or a loader for one). Only a same-origin route may use "server".',
        });
      }
      if (typeof source === "function") {
        this.validatorLoader = source;
      } else {
        this.validator = source;
        this.validatorState = "ready";
      }
    }
    this.catalog.subscribe(() => this.notify());
  }

  resolve(node: unknown, depth: number, final = false): Resolution<I> {
    const type = typeof node === "object" && node !== null ? (node as { type?: unknown }).type : undefined;
    const name = typeof type === "string" ? type : String(type);

    if (depth > this.maxDepth) return this.skip({ reason: "depth_exceeded", type: name }, true);
    if (typeof type !== "string" || !this.types.has(type)) {
      return this.skip({ reason: "unknown_type", type: name }, final);
    }

    // Start fetching the code as soon as the type is known: the props are
    // usually still streaming, and the fetch overlaps them.
    if (this.catalog.state(type) === "lazy") this.catalog.request(type);

    const raw = (node as { props?: unknown }).props;
    let props: Record<string, unknown>;
    if (this.tier === "full") {
      if (this.validatorState !== "ready") {
        this.loadValidator();
        if (this.validatorState === "failed") {
          return this.skip({ reason: "load_failed", type: name, detail: "validator" }, true);
        }
        return { kind: "pending" };
      }
      const checked = this.validator!.props(type, raw ?? {});
      if (!checked.ok) {
        return this.skip(
          { reason: "invalid_props", type, ...(checked.detail !== undefined ? { detail: checked.detail } : {}) },
          final,
        );
      }
      props = checked.props;
    } else {
      props = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    }

    const state = this.catalog.state(type);
    if (state === "ready") {
      if (this.fallbacks.has(type)) this.report({ reason: "fallback", type });
      return { kind: "render", implementation: this.catalog.get(type)!, props };
    }
    if (state === "failed") return this.skip({ reason: "load_failed", type }, true);
    if (state === "absent") return this.skip({ reason: "unknown_type", type, detail: "no implementation" }, true);
    return { kind: "pending" };
  }

  /** A new document begins: reports may repeat, failed loads may retry. */
  startDocument(): void {
    this.reported.clear();
    this.catalog.startDocument();
  }

  /** Called when the validator or an implementation arrives. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private skip(failure: RenderReport, emit: boolean): Resolution<I> {
    if (emit) this.report(failure);
    return { kind: "skip", failure };
  }

  /** Reports to the host, once per reason and type per document. Renderers report their own failures here. */
  report(report: RenderReport): void {
    if (!this.onReport) return;
    const id = `${report.reason}\u0000${report.type}`;
    if (this.reported.has(id)) return;
    this.reported.add(id);
    this.onReport(report);
  }

  private loadValidator(): void {
    if (this.validatorState !== "idle" || !this.validatorLoader) return;
    this.validatorState = "loading";
    let pending: Promise<Validator>;
    try {
      // Called now, not on a later tick: the fetch should start with the frame
      // that needs it.
      pending = Promise.resolve(this.validatorLoader());
    } catch (cause) {
      pending = Promise.reject(cause);
    }
    pending.then(
        (validator) => {
          this.validator = validator;
          this.validatorState = "ready";
          this.notify();
        },
        () => {
          // Fail closed: without a validator nothing from a foreign source
          // may render.
          this.validatorState = "failed";
          this.notify();
        },
      );
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
