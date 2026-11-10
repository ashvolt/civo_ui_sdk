import { RelaxUIError } from "relax-ui-protocol";
import type { Loader } from "./catalog.js";
import type { RenderReport } from "./resolver.js";
import type { Template, VChild, VNode } from "./vnode.js";

/**
 * Connectors: one interface through which any theme library is attached
 * (FR-233).
 *
 * A connector maps contract types onto a library. It never sees model output
 * as anything but validated props, and it cannot write markup: a `class`
 * implementation only renames classes on the base theme's markup, an `element`
 * implementation only swaps the root for a library element and sets attributes
 * from props, and a `template` returns markup as data, which the renderer
 * checks like any other (FR-238, data model I2).
 *
 * Both declarative kinds start from the base theme's own template for the
 * type, so structure, text handling and the ARIA role the contract requires are
 * the base theme's, not re-implemented per library. Base classes follow one
 * naming scheme, which the mapping reads:
 *
 *   gen-card            → classes.root
 *   gen-card__title     → classes.title
 *   gen-tone--warning   → classes.tone.warning
 *   gen-heading--2      → classes.variant["2"]   (a modifier of the component itself)
 *
 * A `gen-` class the mapping does not name is dropped, so a library's styles
 * are not fought by the base theme's. Any other class is kept.
 */

export type ConnectorKind = "class" | "element" | "framework";
export type ConnectorMode = "shadow" | "light";

/** Classes for one component: a part's classes, or classes per modifier value. */
export type ClassMapping = Readonly<Record<string, string | Readonly<Record<string, string>>>>;

/** A class-based library (Bootstrap, Bulma, Tailwind): the base markup, restyled. */
export interface ClassImplementation {
  /** Replaces the root element's tag. Default: the base theme's. */
  tag?: string;
  classes: ClassMapping;
}

/** An attribute value: a constant, or read from a prop and optionally mapped. */
export type PropMapping = string | number | boolean | { from: string; map?: Readonly<Record<string, string>> };

/** A Web-Component library (Shoelace, Material Web): the root becomes its element. */
export interface ElementImplementation {
  /** The library's element, e.g. `sl-card`. */
  tag: string;
  /** Attributes of the root, from props. `true` sets an empty attribute. */
  props?: Readonly<Record<string, PropMapping>>;
  /** Base parts placed in the element's named slots, e.g. `{ title: "header" }`. */
  slots?: Readonly<Record<string, string>>;
}

/** Markup as data, for a type the declarative kinds cannot express. */
export interface TemplateImplementation {
  template: Template;
}

/** What a mounted framework component gives back to the renderer. */
export interface Mounted {
  /** New props for the same node. Called only when they changed. */
  update(props: Record<string, unknown>): void;
  /** The node left the document, or the renderer was destroyed. */
  unmount(): void;
}

/**
 * A framework component (React, Angular, Vue), mounted into a host element the
 * renderer creates (data model §3, `mount`).
 *
 * The renderer owns the tree. `childHost` is an element the renderer fills with
 * the node's children; the component places it where its children belong and
 * never renders model children itself (I3). Props are validated (or from a
 * trusted route), and `href`/`src` have passed the URL guard again.
 */
export interface MountImplementation {
  mount(host: Element, props: Record<string, unknown>, childHost: Element): Mounted;
}

export type Implementation = ClassImplementation | ElementImplementation | TemplateImplementation | MountImplementation;

/** What a catalog holds for the DOM renderer: markup as data, or a mount. */
export type Renderable = Template | MountImplementation;

export function isMount(r: unknown): r is MountImplementation {
  return typeof r === "object" && r !== null && typeof (r as MountImplementation).mount === "function";
}

export interface ConnectorOptions {
  /** Names the library in reports and errors, e.g. `bootstrap-5`. */
  name: string;
  kind: ConnectorKind;
  /**
   * The element mode the library needs (R3). `light` for a global stylesheet
   * unless `stylesheets` can be adopted into a shadow root. Framework
   * connectors are always `light` (K2).
   */
  mode?: ConnectorMode;
  /** Stylesheet URLs a shadow root adopts, fetched once and shared. */
  stylesheets?: readonly string[];
  /** True when the library is on the page. Checked when the connector is used (K3). */
  requires?: () => boolean;
  /**
   * `data-` attributes the renderer's surface carries while a variant is
   * active, for a library with its own switch: Bootstrap's dark mode is
   * `{ dark: { "data-bs-theme": "dark" } }`. `class` adds classes instead,
   * for a library switched by class: `{ dark: { class: "sl-theme-dark" } }`. An attribute, so a switch restyles
   * without re-rendering (FR-232).
   */
  variants?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Type → implementation, or a loader for one (FR-240). */
  implementations: Readonly<Record<string, Implementation | Loader<Implementation>>>;
}

export interface Connector extends Readonly<ConnectorOptions> {
  readonly mode: ConnectorMode;
  readonly stylesheets: readonly string[];
  readonly variants: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const TYPE = /^[A-Z][A-Za-z0-9]{0,31}$/;
const TAG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ATTRIBUTE = /^(?!on)[a-z][a-z0-9-]*$/i;
const DENIED_ATTRIBUTES = new Set(["style", "srcdoc", "formaction", "action", "is", "slot", "xmlns", "class", "href", "src"]);

/**
 * Declares a connector, refusing a malformed one now rather than at render
 * time: an unknown kind, a bad tag, an event-handler attribute.
 */
export function defineConnector(options: ConnectorOptions): Connector {
  const where = `connector "${String(options?.name)}"`;
  if (typeof options !== "object" || options === null) refuse("a connector must be an object");
  if (typeof options.name !== "string" || !NAME.test(options.name)) refuse(`${where}: name must be a short identifier`);
  if (!["class", "element", "framework"].includes(options.kind)) {
    refuse(`${where}: kind must be "class", "element" or "framework"`);
  }
  const stylesheets = options.stylesheets ?? [];
  if (!Array.isArray(stylesheets) || stylesheets.some((s) => typeof s !== "string" || s === "")) {
    refuse(`${where}: stylesheets must be URLs`);
  }
  // A Web-Component library styles itself inside its own shadow roots, so it
  // works isolated; the others style globally.
  const mode: ConnectorMode = options.mode ?? (options.kind === "element" ? "shadow" : "light");
  if (mode !== "shadow" && mode !== "light") refuse(`${where}: mode must be "shadow" or "light"`);
  if (options.kind === "framework" && mode !== "light") {
    refuse(`${where}: a framework connector needs mode "light"; its library injects styles no shadow root sees`);
  }
  if (options.requires !== undefined && typeof options.requires !== "function") {
    refuse(`${where}: requires must be a function`);
  }
  const variants = options.variants ?? {};
  for (const [variant, attributes] of Object.entries(variants)) {
    if (typeof attributes !== "object" || attributes === null) refuse(`${where}: variants.${variant} must map attributes to values`);
    for (const [name, value] of Object.entries(attributes)) {
      const ok =
        typeof value === "string" &&
        (/^data-[a-z0-9-]+$/.test(name) || (name === "class" && /^[A-Za-z0-9_-]+( [A-Za-z0-9_-]+)*$/.test(value)));
      if (!ok) refuse(`${where}: variants.${variant} may set only data- attributes, or add classes ("${name}")`);
    }
  }
  if (typeof options.implementations !== "object" || options.implementations === null) {
    refuse(`${where}: implementations must map component types to implementations`);
  }
  for (const [type, entry] of Object.entries(options.implementations)) {
    if (!TYPE.test(type)) refuse(`${where}: "${type}" is not a component type name`);
    if (typeof entry !== "function") checkImplementation(entry, options.kind, `${where}, ${type}`);
  }
  return Object.freeze({ ...options, mode, stylesheets: Object.freeze([...stylesheets]), variants });
}

/**
 * Checks the connector's library is on the page (K3). A missing library is a
 * configuration error naming it, not a blank screen.
 */
export function checkConnector(connector: Connector): void {
  let present: boolean;
  try {
    present = connector.requires ? connector.requires() === true : true;
  } catch {
    present = false;
  }
  if (!present) {
    throw new RelaxUIError({
      code: "config_invalid",
      message: `The "${connector.name}" library is not on this page: load it before rendering with its connector.`,
    });
  }
}

function checkImplementation(impl: unknown, kind: ConnectorKind, where: string): asserts impl is Implementation {
  if (typeof impl !== "object" || impl === null) refuse(`${where}: an implementation must be an object or a loader`);
  const i = impl as Partial<ClassImplementation & ElementImplementation & TemplateImplementation & MountImplementation>;
  if ("mount" in i) {
    if (kind !== "framework") refuse(`${where}: only a framework connector mounts components`);
    if (typeof i.mount !== "function") refuse(`${where}: mount must be a function`);
    return;
  }
  if ("template" in i) {
    if (typeof i.template !== "function") refuse(`${where}: template must be a function`);
    return;
  }
  if (kind === "framework") refuse(`${where}: a framework connector's implementations come from its framework package`);
  if (i.tag !== undefined && (typeof i.tag !== "string" || !TAG.test(i.tag))) refuse(`${where}: "${String(i.tag)}" is not a tag`);
  if (kind === "class") {
    if (typeof i.classes !== "object" || i.classes === null) refuse(`${where}: a class implementation needs classes`);
    for (const [part, value] of Object.entries(i.classes)) {
      const ok =
        typeof value === "string" ||
        (typeof value === "object" && value !== null && Object.values(value).every((v) => typeof v === "string"));
      if (!ok) refuse(`${where}: classes.${part} must be a string or a map of strings`);
    }
    return;
  }
  // element
  if (typeof i.tag !== "string" || !i.tag.includes("-")) refuse(`${where}: an element implementation needs a custom element tag`);
  for (const name of Object.keys(i.props ?? {})) {
    if (!ATTRIBUTE.test(name) || DENIED_ATTRIBUTES.has(name.toLowerCase())) refuse(`${where}: attribute "${name}" is not allowed`);
  }
  for (const value of Object.values(i.slots ?? {})) {
    if (typeof value !== "string" || !/^[a-z][a-z0-9-]*$/.test(value)) refuse(`${where}: slot names must be identifiers`);
  }
}

// --- compiling an implementation into a template -----------------------------

/**
 * Turns an implementation into a template. `base` is the base theme's template
 * for the same type; `class` and `element` implementations restyle its output.
 */
export function compileImplementation(type: string, impl: Implementation, base: Template | undefined): Renderable {
  if ("mount" in impl) return impl;
  if ("template" in impl) return impl.template;
  if (base === undefined) {
    throw new RelaxUIError({
      code: "config_invalid",
      message: `"${type}" has no base implementation to restyle; give it a template.`,
    });
  }
  const component = type.toLowerCase();
  if ("classes" in impl) {
    const restyle = (props: never) => restyled(base(props), impl, component);
    return restyle as Template;
  }
  const element = (props: Record<string, unknown>) => asElement(base(props as never), impl as ElementImplementation, component, props);
  return element as unknown as Template;
}

function restyled(v: VNode, impl: ClassImplementation, component: string): VNode {
  const map = (node: VNode, root: boolean): VNode => {
    const attrs: Record<string, string> = {};
    for (const [name, value] of Object.entries(node.attrs)) {
      if (name !== "class") attrs[name] = value;
    }
    const classes = mapClasses(node.attrs.class, impl.classes, component);
    if (classes !== "") attrs.class = classes;
    return {
      tag: root && impl.tag !== undefined ? impl.tag : node.tag,
      attrs,
      children: node.children.map((c) => (isNode(c) ? map(c, false) : c)),
    };
  };
  return map(v, true);
}

function mapClasses(value: string | undefined, classes: ClassMapping, component: string): string {
  if (value === undefined) return "";
  const out: string[] = [];
  for (const token of value.split(/\s+/)) {
    if (token === "") continue;
    if (!token.startsWith("gen-")) {
      out.push(token);
      continue;
    }
    const name = token.slice(4);
    const modifier = name.indexOf("--");
    let mapped: string | undefined;
    if (modifier === -1) {
      const part = name === component ? "root" : name.startsWith(`${component}__`) ? name.slice(component.length + 2) : undefined;
      const entry = part === undefined ? undefined : classes[part];
      mapped = typeof entry === "string" ? entry : undefined;
    } else {
      let axis = name.slice(0, modifier);
      const option = name.slice(modifier + 2);
      axis = axis === component ? "variant" : axis.startsWith(`${component}__`) ? axis.slice(component.length + 2) : axis;
      const entry = classes[axis];
      mapped = typeof entry === "object" ? entry[option] : undefined;
    }
    if (mapped !== undefined) out.push(...mapped.split(/\s+/));
  }
  return [...new Set(out.filter((t) => t !== ""))].join(" ");
}

function asElement(v: VNode, impl: ElementImplementation, component: string, props: Record<string, unknown>): VNode {
  const attrs: Record<string, string> = {};
  for (const [name, value] of Object.entries(v.attrs)) {
    // The root's base classes would style the library's element as a base
    // card, box or badge: the library draws that itself.
    if (name !== "class") attrs[name] = value;
  }
  for (const [name, mapping] of Object.entries(impl.props ?? {})) {
    const value = attributeValue(mapping, props);
    if (value !== undefined) attrs[name] = value;
  }
  const slotted = (node: VNode): VNode => {
    const part = partOf(node.attrs.class, component);
    const slot = part === undefined ? undefined : impl.slots?.[part];
    return {
      tag: node.tag,
      attrs: slot === undefined ? node.attrs : { ...node.attrs, slot },
      children: node.children.map((c) => (isNode(c) ? slotted(c) : c)),
    };
  };
  return { tag: impl.tag, attrs, children: v.children.map((c) => (isNode(c) ? slotted(c) : c)) };
}

function attributeValue(mapping: PropMapping, props: Record<string, unknown>): string | undefined {
  if (typeof mapping === "boolean") return mapping ? "" : undefined;
  if (typeof mapping === "string" || typeof mapping === "number") return String(mapping);
  const raw = props[mapping.from];
  if (raw === undefined || raw === null || typeof raw === "object") return undefined;
  const text = String(raw);
  return mapping.map ? mapping.map[text] : text;
}

function partOf(value: string | undefined, component: string): string | undefined {
  const prefix = `gen-${component}__`;
  const token = value?.split(/\s+/).find((t) => t.startsWith(prefix) && !t.includes("--"));
  return token?.slice(prefix.length);
}

function isNode(c: VChild): c is VNode {
  return typeof c === "object" && c !== null;
}

// --- layering ----------------------------------------------------------------

export interface LayerOptions {
  /** The contract's component names. */
  types: readonly string[];
  /** The base theme: what every type falls back to (FR-237). */
  base: {
    templates?: Readonly<Record<string, Template>>;
    loaders?: Readonly<Record<string, Loader<Template>>>;
  };
  /** Layered in order after the base theme; a later one wins a type (K4). */
  connectors: readonly Connector[];
}

export interface Layered {
  templates: Record<string, Renderable>;
  loaders: Record<string, Loader<Renderable>>;
  /** Types the base theme renders although connectors are attached (K1). */
  fallbacks: ReadonlySet<string>;
  /** A type claimed by more than one connector: the later one wins (K4). */
  overrides: readonly RenderReport[];
  /** Which connector renders each type; absent means the base theme. */
  providers: Readonly<Record<string, string>>;
}

/**
 * The type → implementation table for one renderer: the base theme, then each
 * connector in order (data model §5). Builds loaders; loads nothing.
 */
export function layerConnectors(options: LayerOptions): Layered {
  const winners = new Map<string, { connector: Connector; entry: Implementation | Loader<Implementation> }>();
  const overrides: RenderReport[] = [];
  for (const connector of options.connectors) {
    for (const [type, entry] of Object.entries(connector.implementations)) {
      const previous = winners.get(type);
      if (previous) {
        overrides.push({ reason: "override", type, detail: `${connector.name} over ${previous.connector.name}` });
      }
      winners.set(type, { connector, entry });
    }
  }

  const baseTemplates = options.base.templates ?? {};
  const baseLoaders = options.base.loaders ?? {};
  const baseFor = (type: string): Promise<Template | undefined> =>
    baseTemplates[type] !== undefined
      ? Promise.resolve(baseTemplates[type])
      : baseLoaders[type] !== undefined
        ? baseLoaders[type]!()
        : Promise.resolve(undefined);

  const templates: Record<string, Renderable> = {};
  const loaders: Record<string, Loader<Renderable>> = {};
  const fallbacks = new Set<string>();
  const providers: Record<string, string> = {};

  for (const type of options.types) {
    const winner = winners.get(type);
    if (winner) {
      providers[type] = winner.connector.name;
      const { entry, connector } = winner;
      if (typeof entry !== "function" && ("template" in entry || "mount" in entry)) {
        templates[type] = "mount" in entry ? entry : entry.template;
        continue;
      }
      loaders[type] = async () => {
        const impl = typeof entry === "function" ? await entry() : entry;
        if (typeof entry === "function") checkImplementation(impl, connector.kind, `connector "${connector.name}", ${type}`);
        const base = "template" in impl || "mount" in impl ? undefined : await baseFor(type);
        return compileImplementation(type, impl, base);
      };
      continue;
    }
    if (baseTemplates[type] !== undefined) templates[type] = baseTemplates[type]!;
    else if (baseLoaders[type] !== undefined) loaders[type] = baseLoaders[type]!;
    else continue;
    if (options.connectors.length > 0) fallbacks.add(type);
  }
  return { templates, loaders, fallbacks, overrides, providers };
}

function refuse(message: string): never {
  throw new RelaxUIError({ code: "config_invalid", message });
}
