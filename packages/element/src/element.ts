import {
  measureTree,
  readSource,
  RelaxUIError,
  resolveValidation,
  sourceKind,
  UIStreamAccumulator,
  type GenerationMetadata,
  type JsonValue,
  type Source,
  type StructuringStrategyName,
  type UINode,
  type UIStreamEvent,
  type ValidationTier,
} from "relax-ui-protocol";
import {
  checkConnector,
  createCatalog,
  DomRenderer,
  layerConnectors,
  type Connector,
  type RenderReport,
  type Template,
  type ValidatorSource,
} from "relax-ui-render";
import { baseLoaders } from "relax-ui-theme-base";
import { adoptCss, adoptUrls, hostCss } from "./styles.js";

/**
 * `<gen-ui>`: renders a generated document from any source, in any host — plain
 * HTML, Angular, Vue, a micro-frontend — with no framework package (FR-220,
 * FR-221).
 *
 *   <gen-ui source="/api/ui" validate="server" variant="dark"></gen-ui>
 *   el.source = { socket: ws };            // starts reading
 *   await el.submit({ topic: "…" });       // a URL source: POSTs, then reads
 *
 * The rules are the render core's, unchanged: only contract types render,
 * validation follows the trust tier, code loads on first use. This file adds
 * the host-facing parts: attributes, sources, events and style isolation.
 */

/** What the element reports to its host, as the React hook does (FR-223). */
export interface RenderState {
  status: "idle" | "streaming" | "complete" | "error";
  strategy: StructuringStrategyName | undefined;
  provider: string | undefined;
  metadata: GenerationMetadata | undefined;
  error: { code: string; message: string; details?: JsonValue } | undefined;
  /** Types the base theme drew because no connector implements them (K1). */
  fallbacks: string[];
  /** Types whose code failed to load (FR-244). */
  loadFailures: string[];
  /** Types claimed by more than one connector, with who won (K4). */
  overrides: string[];
  /** Nodes not rendered: unknown type, invalid props, too deep. */
  refused: RenderReport[];
}

/** The part of a `relax-ui-contract` contract the element reads. */
export interface ContractLike {
  readonly names: readonly string[];
  readonly limits?: { readonly maxNodes: number; readonly maxDepth: number };
  spec(type: string): unknown;
}

export type GenUIMode = "shadow" | "light";

const DEFAULT_LIMITS = { maxNodes: 500, maxDepth: 24 };
const STANDARD_TYPES = Object.keys(baseLoaders);

const initialState = (): RenderState => ({
  status: "idle",
  strategy: undefined,
  provider: undefined,
  metadata: undefined,
  error: undefined,
  fallbacks: [],
  loadFailures: [],
  overrides: [],
  refused: [],
});

// Server rendering and tests without a DOM can import this module.
const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

export class GenUIElement extends Base {
  static readonly observedAttributes = ["mode", "variant"];

  #source: Source | undefined;
  #connectors: readonly Connector[] = [];
  #contract: ContractLike | undefined;
  #validator: ValidatorSource | undefined;
  #fallback: ((report: RenderReport) => Node | null) | undefined;

  #mode: GenUIMode | undefined;
  #surface: HTMLElement | undefined;
  #renderer: DomRenderer | undefined;
  #rendererKey: unknown[] = [];
  #overrides: string[] = [];
  #variantAttributes: string[] = [];
  #controller: AbortController | undefined;
  #run = 0;
  #autostart = false;
  #state: RenderState = initialState();

  // --- properties -------------------------------------------------------------

  /**
   * Where the document comes from: `{ document }`, `{ url }`, `{ stream }` or
   * `{ socket }`. A URL waits for `submit()`; any other kind starts reading as
   * soon as the element is on the page. Takes precedence over the attribute.
   *
   * A string is a URL, as the attribute is: Vue and others set a custom
   * element's property, not its attribute, whenever the property exists.
   */
  get source(): Source | undefined {
    return this.#source ?? this.#attributeSource();
  }

  set source(value: Source | string | null | undefined) {
    const source = typeof value === "string" ? (value === "" ? undefined : { url: value }) : (value ?? undefined);
    this.#source = source;
    this.#autostart = source !== undefined && !isUrl(source);
    if (this.#autostart && this.isConnected) this.#startAuto();
  }

  /** Theme libraries layered after the base theme, later ones winning (K4). */
  get connectors(): readonly Connector[] {
    return this.#connectors;
  }

  set connectors(connectors: readonly Connector[]) {
    this.#connectors = Object.freeze([...(connectors ?? [])]);
    this.#applyVariant();
  }

  /** The application's contract: the standard one, extended. Default: standard. */
  get contract(): ContractLike | undefined {
    return this.#contract;
  }

  set contract(contract: ContractLike | undefined) {
    this.#contract = contract;
  }

  /**
   * The props validator for `validate="full"`. Default: built from `contract`
   * by `relax-ui-contract`, loaded on the first node — so a page using
   * `validate="server"` never downloads Zod (FR-208).
   */
  get validator(): ValidatorSource | undefined {
    return this.#validator;
  }

  set validator(validator: ValidatorSource | undefined) {
    this.#validator = validator;
  }

  /** What to show for a node that will not render. Default: nothing. */
  get fallback(): ((report: RenderReport) => Node | null) | undefined {
    return this.#fallback;
  }

  set fallback(fallback: ((report: RenderReport) => Node | null) | undefined) {
    this.#fallback = fallback;
  }

  /** The latest state; also delivered by `gen-ui:state`. */
  get state(): RenderState {
    return structuredCopy(this.#state);
  }

  // --- lifecycle --------------------------------------------------------------

  connectedCallback(): void {
    this.#setup();
    if (this.#autostart) this.#startAuto();
  }

  disconnectedCallback(): void {
    // A move (remove, then insert) is not a stop: check once the DOM settles.
    queueMicrotask(() => {
      if (!this.isConnected) this.stop();
    });
  }

  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (name === "variant") this.#applyVariant();
    if (name === "mode" && this.#mode !== undefined && previous !== next) {
      this.#fail(
        new RelaxUIError({
          code: "config_invalid",
          message: "`mode` is fixed once the element is on the page; set it in the markup or before inserting.",
        }),
      );
    }
  }

  // --- commands ---------------------------------------------------------------

  /**
   * Reads the source from the start. For a URL source `body` is POSTed as
   * JSON. Resolves when the document is complete, failed or stopped; never
   * rejects — failures arrive as state and `gen-ui:error`.
   */
  submit(body?: unknown): Promise<void> {
    this.#autostart = false;
    return this.#read(body);
  }

  /** Stops reading. What has rendered stays; a socket is never closed (S2). */
  stop(): void {
    this.#run++;
    this.#controller?.abort();
    this.#controller = undefined;
    if (this.#state.status === "streaming") this.#setState({ status: "idle" });
  }

  // --- internals --------------------------------------------------------------

  #startAuto(): void {
    this.#autostart = false;
    void this.#read(undefined);
  }

  #attributeSource(): Source | undefined {
    const url = this.getAttribute("source");
    return url ? { url } : undefined;
  }

  #setup(): void {
    if (this.#surface) return;
    const doc = this.ownerDocument;
    const mode: GenUIMode = this.getAttribute("mode") === "light" ? "light" : "shadow";
    this.#mode = mode;
    const surface = doc.createElement("div");
    surface.className = "gen-theme";
    surface.setAttribute("part", "surface");
    if (mode === "shadow") {
      const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
      adoptCss(root, "shadow", hostCss(":host"));
      root.replaceChildren(surface);
    } else {
      // Light mode: the base theme is scoped by class and to this element's
      // name, so adopting it into the page styles nothing else.
      adoptCss(doc, `light:${this.localName}`, hostCss(this.localName));
      this.appendChild(surface);
    }
    this.#surface = surface;
    this.#applyVariant();
  }

  /**
   * A connector's own switch for the active variant, as attributes on the
   * surface: the base theme's tokens follow the host attribute through CSS,
   * and a library like Bootstrap follows its `data-bs-theme`.
   */
  #applyVariant(): void {
    const surface = this.#surface;
    if (!surface) return;
    for (const name of this.#variantAttributes) {
      if (name.startsWith(".")) surface.classList.remove(name.slice(1));
      else surface.removeAttribute(name);
    }
    const variant = this.getAttribute("variant") ?? "light";
    const applied: string[] = [];
    for (const connector of this.#connectors) {
      for (const [name, value] of Object.entries(connector.variants[variant] ?? {})) {
        if (name === "class") {
          // Added beside `gen-theme`, never replacing it.
          for (const token of value.split(" ").filter((t) => t !== "gen-theme")) {
            surface.classList.add(token);
            applied.push(`.${token}`);
          }
        } else {
          surface.setAttribute(name, value);
          applied.push(name);
        }
      }
    }
    this.#variantAttributes = applied;
  }

  async #read(body: unknown): Promise<void> {
    this.#setup();
    this.stop();
    const run = ++this.#run;
    const controller = new AbortController();
    this.#controller = controller;

    let source: Source;
    let renderer: DomRenderer;
    let limits: { maxNodes: number; maxDepth: number };
    try {
      const chosen = this.source;
      if (chosen === undefined) {
        throw new RelaxUIError({ code: "config_invalid", message: "<gen-ui> has no source: set `source`." });
      }
      source = chosen;
      // Refused before anything is fetched, listened to or rendered (S1).
      const tier = resolveValidation(source, validateAttribute(this.getAttribute("validate")));
      limits = { ...DEFAULT_LIMITS, ...this.#contract?.limits };
      renderer = this.#ensureRenderer(tier, limits.maxDepth);
    } catch (cause) {
      this.#fail(cause);
      return;
    }

    renderer.startDocument();
    this.#setState({
      status: "streaming",
      strategy: undefined,
      provider: undefined,
      metadata: undefined,
      error: undefined,
      fallbacks: [],
      loadFailures: [],
      overrides: this.#overrides,
      refused: [],
    });

    const accumulator = new UIStreamAccumulator();
    const draw = (value: unknown, complete: boolean) => {
      const root = (value as { root?: UINode } | undefined)?.root;
      // Feature 001's node budget, in the browser too (spec, Edge Cases).
      if (root && measureTree(root).nodes > limits.maxNodes) {
        throw new RelaxUIError({
          code: "schema_violation",
          message: `The document has more than ${limits.maxNodes} nodes; it was not rendered further.`,
        });
      }
      renderer.render(root, { complete });
    };

    try {
      for await (const event of readSource(source, { signal: controller.signal, body })) {
        if (run !== this.#run) return;
        accumulator.apply(event);
        this.#emit("gen-ui:frame", event satisfies UIStreamEvent);
        switch (event.type) {
          case "meta":
            this.#setState({ strategy: event.strategy, provider: event.provider });
            break;
          case "patch":
          case "snapshot":
            draw(accumulator.current(), false);
            break;
          case "complete":
            draw(event.value, true);
            this.#setState({ status: "complete", metadata: event.metadata });
            this.#emit("gen-ui:complete", { value: event.value, metadata: event.metadata });
            return;
          case "error":
            throw new RelaxUIError({
              code: (event.error.code as RelaxUIError["code"]) ?? "transport_error",
              message: event.error.message,
              retryable: event.error.retryable,
              ...(event.error.details !== undefined ? { details: event.error.details } : {}),
            });
        }
      }
      if (run !== this.#run) return;
      if (sourceKind(source) === "document") {
        // Complete by definition: refusals are reported now.
        const value = accumulator.current();
        draw(value, true);
        this.#setState({ status: "complete" });
        this.#emit("gen-ui:complete", { value, metadata: undefined });
        return;
      }
      this.#setState({ status: "idle" });
    } catch (cause) {
      if (controller.signal.aborted || run !== this.#run) return;
      controller.abort();
      this.#fail(cause);
    }
  }

  /** The renderer for the current configuration; rebuilt only when it changes. */
  #ensureRenderer(tier: ValidationTier, maxDepth: number): DomRenderer {
    const preload = (this.getAttribute("preload") ?? "").split(/\s+/).filter(Boolean);
    const key = [tier, maxDepth, this.#connectors, this.#contract, this.#validator, this.#fallback, preload.join(" ")];
    if (this.#renderer && key.every((k, i) => k === this.#rendererKey[i])) return this.#renderer;

    const mode = this.#mode!;
    for (const connector of this.#connectors) {
      if (mode === "shadow" && connector.mode === "light" && connector.stylesheets.length === 0) {
        throw new RelaxUIError({
          code: "config_invalid",
          message:
            `The "${connector.name}" connector needs mode="light": its library's styles are global and cannot reach ` +
            `into a shadow root. Set mode="light" on the element, or give the connector stylesheets to adopt.`,
        });
      }
      checkConnector(connector);
    }
    if (mode === "shadow") {
      const urls = this.#connectors.flatMap((c) => c.stylesheets);
      if (urls.length > 0) {
        void adoptUrls(this.shadowRoot!, urls).then((failed) => {
          if (failed.length > 0) this.#setState({ loadFailures: [...this.#state.loadFailures, ...failed] });
        });
      }
    }

    const types = this.#contract?.names ?? STANDARD_TYPES;
    const layered = layerConnectors({
      types,
      base: { loaders: baseLoaders as unknown as Record<string, () => Promise<Template>> },
      connectors: this.#connectors,
    });
    const contract = this.#contract;
    const validator: ValidatorSource | undefined =
      tier === "full"
        ? (this.#validator ??
          (() => import("relax-ui-contract").then((m) => m.createValidator((contract ?? m.standardContract) as never))))
        : undefined;

    this.#renderer?.destroy();
    this.#surface!.replaceChildren();
    const fallback = this.#fallback;
    this.#renderer = new DomRenderer(this.#surface!, {
      catalog: createCatalog({
        templates: layered.templates,
        loaders: layered.loaders,
        preload: preload.filter((t) => types.includes(t)),
      }),
      types,
      validate: tier,
      validator,
      maxDepth,
      fallbacks: layered.fallbacks,
      onReport: (report) => this.#report(report),
      ...(fallback ? { fallback } : {}),
    });
    this.#rendererKey = key;
    this.#overrides = layered.overrides.map((r) => `${r.type}: ${r.detail}`);
    return this.#renderer;
  }

  #report(report: RenderReport): void {
    const s = this.#state;
    switch (report.reason) {
      case "fallback":
        this.#setState({ fallbacks: [...s.fallbacks, report.type] });
        break;
      case "load_failed":
        this.#setState({ loadFailures: [...s.loadFailures, report.detail ?? report.type] });
        break;
      case "override":
        break;
      default:
        this.#setState({ refused: [...s.refused, report] });
    }
  }

  #fail(cause: unknown): void {
    const error = cause instanceof RelaxUIError
      ? cause
      : new RelaxUIError({ code: "transport_error", message: cause instanceof Error ? cause.message : String(cause), cause });
    const detail = {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
    this.#setState({ status: "error", error: detail });
    this.#emit("gen-ui:error", detail);
  }

  #setState(patch: Partial<RenderState>): void {
    this.#state = { ...this.#state, ...patch };
    this.#emit("gen-ui:state", this.state);
  }

  #emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

function isUrl(source: Source): boolean {
  return typeof source === "object" && source !== null && "url" in source;
}

function validateAttribute(value: string | null): ValidationTier | undefined {
  if (value === null || value === "") return undefined;
  // Anything else is passed through, and refused by `resolveValidation`.
  return value as ValidationTier;
}

function structuredCopy(state: RenderState): RenderState {
  return {
    ...state,
    fallbacks: [...state.fallbacks],
    loadFailures: [...state.loadFailures],
    overrides: [...state.overrides],
    refused: state.refused.map((r) => ({ ...r })),
  };
}
