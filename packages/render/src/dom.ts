import { sanitizeUrl, type UINode } from "relax-ui-protocol";
import { Resolver, type RenderReport, type ResolverOptions } from "./resolver.js";
import { CHILDREN, type Template, type VChild, type VNode } from "./vnode.js";

/**
 * The DOM backend: turns documents into DOM, frame after frame, touching as
 * little as possible.
 *
 * It leans on a property the protocol already guarantees. `applyPatch` shares
 * structure, so a subtree no patch touched is the *same object* in the next
 * document. Reconciling is therefore mostly identity checks:
 *
 * - same node object, nothing pending inside → skip the whole subtree;
 * - same props object → keep the element, reconcile only the children;
 * - new props → re-run the template and patch the element in place, so a
 *   streaming text prop updates one text node;
 * - children are matched by the model's `key`, else by type and position.
 *
 * Output safety does not depend on templates behaving: every tag and attribute
 * passes an allowlist here, URLs pass the guard again, and text is only ever a
 * text node. There is no code path from a string to markup.
 */

export interface DomRendererOptions extends ResolverOptions<Template> {
  /**
   * What to show for a node that will not render (unknown type, invalid props,
   * failed load). Default: nothing.
   */
  fallback?: (failure: RenderReport) => Node | null;
}

export interface RenderOptions {
  /** The document is complete: report what was refused (once per type). */
  complete?: boolean;
}

interface Rendered {
  /** The node object this was rendered from: the identity check. */
  node: unknown;
  key: string;
  kind: "render" | "pending" | "skip";
  type: string;
  dom: Node;
  template?: Template;
  rawProps?: unknown;
  vnode?: VNode;
  childHost: Element | null;
  children: Rendered[];
  /** This node or one below it is waiting for code: not safe to skip. */
  waiting: boolean;
  failureKey?: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set(["svg", "g", "rect", "line", "polyline", "circle", "text"]);
// Elements that execute, embed, submit or load: never created, whatever a
// template asks for. Custom elements (`sl-card`) pass, for phase 4 connectors.
const DENIED_TAGS = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta", "base",
  "template", "noscript", "form", "input", "button", "textarea", "select", "option", "portal",
  "foreignobject", "use", "image", "animate", "set", "animatemotion", "animatetransform", "math",
]);
const TAG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ATTRIBUTE = /^(?!on)[a-z][a-z0-9-]*$/i;
// `slot` is allowed: Web-Component connectors place base parts in a library
// element's named slots. Its value comes from the connector, never a prop.
const DENIED_ATTRIBUTES = new Set(["style", "srcdoc", "formaction", "action", "is", "xmlns"]);
const URL_ATTRIBUTES = new Set(["href", "src", "poster", "cite", "data"]);

export class DomRenderer {
  readonly resolver: Resolver<Template>;
  private readonly container: Element;
  private readonly fallback: ((failure: RenderReport) => Node | null) | undefined;
  private readonly doc: Document;
  private root: Rendered | undefined;
  private last: UINode | undefined;
  private lastOptions: RenderOptions = {};
  private readonly unsubscribe: () => void;

  constructor(container: Element, options: DomRendererOptions) {
    this.container = container;
    this.doc = container.ownerDocument;
    this.fallback = options.fallback;
    this.resolver = new Resolver(options);
    // Code or the validator arrived: draw what was waiting. Nodes with nothing
    // pending are skipped by identity, so this costs only the waiting paths.
    this.unsubscribe = this.resolver.subscribe(() => this.render(this.last, this.lastOptions));
  }

  render(root: UINode | undefined, options: RenderOptions = {}): void {
    this.last = root;
    this.lastOptions = options;
    if (root === undefined || root === null) {
      this.root = undefined;
      this.container.replaceChildren();
      return;
    }
    this.root = this.reconcile(this.root, root, "root", 1, options.complete === true);
    if (this.container.firstChild !== this.root.dom || this.container.childNodes.length !== 1) {
      this.container.replaceChildren(this.root.dom);
    }
  }

  /** A new document begins (a new submit): reports repeat, failed loads retry. */
  startDocument(): void {
    this.resolver.startDocument();
  }

  /** Stops listening for loads. The container is left as it is. */
  destroy(): void {
    this.unsubscribe();
  }

  // --- reconciliation -------------------------------------------------------

  private reconcile(prev: Rendered | undefined, node: unknown, key: string, depth: number, final: boolean): Rendered {
    if (prev && prev.node === node && !prev.waiting && !final) return prev;

    const resolution = this.resolver.resolve(node, depth, final);
    const type = typeof (node as { type?: unknown })?.type === "string" ? (node as { type: string }).type : "";
    const children = depth >= this.resolver.maxDepth + 1 ? [] : childNodes(node);

    if (resolution.kind === "skip") {
      const failureKey = `${resolution.failure.reason}:${resolution.failure.type}`;
      if (prev && prev.kind === "skip" && prev.failureKey === failureKey) {
        return { ...prev, node, waiting: false };
      }
      const dom = this.fallback?.(resolution.failure) ?? this.doc.createComment("");
      return { node, key, kind: "skip", type, dom, childHost: null, children: [], waiting: false, failureKey };
    }

    if (resolution.kind === "pending") {
      // A placeholder of the same role, so layout does not jump twice, and a
      // host for the children: they do not wait for their parent's code.
      let dom: Element;
      if (prev && prev.kind === "pending" && prev.type === type) {
        dom = prev.dom as Element;
      } else {
        dom = this.doc.createElement("div");
        dom.setAttribute("class", "gen-pending");
        dom.setAttribute("aria-busy", "true");
      }
      const kids = this.reconcileChildren(dom, prev?.childHost === dom ? prev.children : adopt(prev), children, depth, final);
      return { node, key, kind: "pending", type, dom, childHost: dom, children: kids, waiting: true };
    }

    const template = resolution.implementation;
    const rawProps = (node as { props?: unknown }).props;
    let dom: Node;
    let vnode: VNode;
    let childHost: Element | null;

    if (prev && prev.kind === "render" && prev.template === template && prev.rawProps === rawProps && !final) {
      // Only the children changed: keep the element.
      dom = prev.dom;
      vnode = prev.vnode!;
      childHost = prev.childHost;
    } else {
      vnode = checked(template(resolution.props as never));
      if (prev && prev.kind === "render" && prev.template === template && prev.vnode) {
        const patched = this.patch(prev.dom as Element, prev.vnode, vnode);
        dom = patched.el;
        childHost = patched.childHost;
      } else {
        const created = this.create(vnode);
        dom = created.el;
        childHost = created.childHost;
      }
    }

    const previousKids = prev?.childHost && prev.childHost === childHost ? prev.children : adopt(prev);
    const kids = childHost ? this.reconcileChildren(childHost, previousKids, children, depth, final) : [];
    return {
      node,
      key,
      kind: "render",
      type,
      dom,
      template,
      rawProps,
      vnode,
      childHost,
      children: kids,
      waiting: kids.some((k) => k.waiting),
    };
  }

  private reconcileChildren(host: Element, prev: Rendered[], nodes: unknown[], depth: number, final: boolean): Rendered[] {
    const byKey = new Map<string, Rendered>();
    for (const r of prev) byKey.set(r.key, r);

    const seen = new Set<string>();
    const next: Rendered[] = nodes.map((child, index) => {
      let key = childKey(child, index);
      if (seen.has(key)) key = `${key}#${index}`;
      seen.add(key);
      const match = byKey.get(key);
      byKey.delete(key);
      return this.reconcile(match, child, key, depth + 1, final);
    });

    // Place each child's DOM node at its position; drop the rest. Only nodes
    // that moved are touched.
    const wanted = new Set(next.map((r) => r.dom));
    for (const existing of [...host.childNodes]) if (!wanted.has(existing)) existing.remove();
    next.forEach((r, i) => {
      const at = host.childNodes[i];
      if (at !== r.dom) host.insertBefore(r.dom, at ?? null);
    });
    return next;
  }

  // --- markup ---------------------------------------------------------------

  private create(v: VNode): { el: Element; childHost: Element | null } {
    const el = this.element(v.tag);
    setAttributes(el, {}, v.attrs);
    let childHost: Element | null = null;
    for (const child of v.children) {
      if (child === CHILDREN) {
        childHost = el;
      } else if (typeof child === "string") {
        el.appendChild(this.doc.createTextNode(child));
      } else if (typeof child === "object" && allowedTag(child.tag)) {
        const made = this.create(child);
        el.appendChild(made.el);
        childHost ??= made.childHost;
      }
    }
    return { el, childHost };
  }

  /** Brings `el`, drawn from `old`, in line with `next`. May replace it. */
  private patch(el: Element, old: VNode, next: VNode): { el: Element; childHost: Element | null } {
    if (old.tag !== next.tag) {
      const made = this.create(next);
      el.replaceWith(made.el);
      return made;
    }
    setAttributes(el, old.attrs, next.attrs);
    if (next.children.includes(CHILDREN)) {
      // A slot: this element's children are the reconciler's, not the template's.
      return { el, childHost: el };
    }

    let childHost: Element | null = null;
    const oldKids = old.children.filter(allowedChild);
    const newKids = next.children.filter(allowedChild);
    const domKids = [...el.childNodes];
    newKids.forEach((child, i) => {
      const before = oldKids[i];
      const dom = domKids[i];
      if (typeof child === "string") {
        if (typeof before === "string" && dom && dom.nodeType === 3) {
          if (before !== child) (dom as Text).data = child;
        } else {
          const text = this.doc.createTextNode(child);
          if (dom) dom.replaceWith(text);
          else el.appendChild(text);
        }
      } else if (typeof child === "object") {
        if (before && typeof before === "object" && dom && dom.nodeType === 1) {
          const patched = this.patch(dom as Element, before, child);
          childHost ??= patched.childHost;
        } else {
          const made = this.create(child);
          if (dom) dom.replaceWith(made.el);
          else el.appendChild(made.el);
          childHost ??= made.childHost;
        }
      }
    });
    for (const extra of domKids.slice(newKids.length)) extra.remove();
    return { el, childHost };
  }

  private element(tag: string): Element {
    return SVG_TAGS.has(tag) ? this.doc.createElementNS(SVG_NS, tag) : this.doc.createElement(tag);
  }
}

// --- helpers ----------------------------------------------------------------

function childNodes(node: unknown): unknown[] {
  const children = (node as { children?: unknown })?.children;
  return Array.isArray(children) ? children.filter((c) => c !== null && c !== undefined) : [];
}

function childKey(child: unknown, index: number): string {
  const key = (child as { key?: unknown })?.key;
  if (typeof key === "string" && key !== "") return `k:${key}`;
  const type = (child as { type?: unknown })?.type;
  return `i:${typeof type === "string" ? type : "?"}:${index}`;
}

/** The previous node's children, when its element is being replaced. */
function adopt(prev: Rendered | undefined): Rendered[] {
  return prev?.children ?? [];
}

function allowedTag(tag: string): boolean {
  return TAG.test(tag) && !DENIED_TAGS.has(tag.toLowerCase());
}

function allowedChild(child: VChild): boolean {
  if (typeof child === "string" || child === CHILDREN) return true;
  return typeof child === "object" && child !== null && allowedTag(child.tag);
}

/** Validates a template's output once, where a mistake is a programming error. */
function checked(v: VNode): VNode {
  if (!v || typeof v !== "object" || typeof v.tag !== "string" || !allowedTag(v.tag)) {
    throw new TypeError(`A template returned a root element that is not allowed: ${String(v?.tag)}.`);
  }
  const stack: VNode[] = [v];
  while (stack.length > 0) {
    const n = stack.pop()!;
    const slot = n.children.indexOf(CHILDREN);
    if (slot !== -1 && n.children.length !== 1) {
      throw new TypeError(`<${n.tag}>: the children slot must be the element's only child.`);
    }
    for (const c of n.children) if (typeof c === "object" && c !== null) stack.push(c);
  }
  return v;
}

function setAttributes(el: Element, old: Readonly<Record<string, string>>, next: Readonly<Record<string, string>>): void {
  for (const name of Object.keys(old)) {
    if (!(name in next)) el.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(next)) {
    if (!ATTRIBUTE.test(name) || DENIED_ATTRIBUTES.has(name.toLowerCase())) continue;
    let safe: string | null = value;
    if (URL_ATTRIBUTES.has(name.toLowerCase())) safe = sanitizeUrl(value);
    if (safe === null) {
      el.removeAttribute(name);
    } else if (old[name] !== value || el.getAttribute(name) !== safe) {
      el.setAttribute(name, safe);
    }
  }
}
