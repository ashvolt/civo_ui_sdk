import { noEvidence, type Evidence } from "./classify.ts";
import { PWN_HOST } from "./corpus.ts";
import { buildProtocolCase, type ProtocolBuild } from "./protocol.ts";

/**
 * The in-page half of the attack harness (plan D7): one case at a time, a
 * fresh renderer, and the evidence a quiet failure cannot hide.
 *
 * - **canary**: payloads call `window.__relaxPwned(id)` if they ever run;
 * - **policy**: the page is served with a report-only Content Security Policy
 *   (`?attack`), so a violation is reported and the payload still runs;
 * - **dom**: the rendered tree, shadow roots included, against the benign
 *   document's: no element or attribute it never draws, no handler
 *   attribute, no URL with a forbidden scheme, no CSS that loads;
 * - **globals**: built-in prototypes, the window and the renderer's own
 *   element class, before and after;
 * - **bounds**: generated elements drawn outside the host's box.
 *
 * Requests that leave the page are seen by the runner, outside the page.
 */

export interface AttackSetup {
  /** What the renderer reads: `{ url }` for a route, or a stream or socket made in the page. */
  source: object;
  validate: "full" | "server";
  /** The standard contract, with its document budgets, instead of the bench's. */
  contract?: "bench" | "standard";
}

export interface Settled {
  status: string;
  /** Nodes the renderer refused (unknown type, invalid props, too deep). */
  refused: number;
  errorCode?: string;
}

export interface AttackMount {
  /** Resolves when the renderer has finished: complete, refused or failed. */
  settled(): Promise<Settled>;
  /** Where the renderer draws, for the scans. */
  surface(): Node | null;
  /** The host's way to stop reading, where it has one. */
  stop?(): void;
  unmount(): void;
}

export interface AttackAdapter {
  attack(host: HTMLElement, setup: AttackSetup): Promise<AttackMount>;
}

export interface CaseReport extends Settled {
  evidence: Omit<Evidence, "requests">;
  timedOut?: boolean;
  /** Longest gap between animation frames while the case ran, ms. */
  maxFrameGap: number;
  /** The surface's text, for checks that nothing was half-applied. */
  text: string;
  ms: number;
  /** From the bad input to the renderer settling, ms (protocol cases). */
  failClosedMs?: number;
}

interface Profile {
  tags: Set<string>;
  attrs: Set<string>;
  escapes: Set<string>;
}

declare global {
  interface Window {
    __relaxPwned(id: unknown): void;
    __attack: {
      ready: boolean;
      /** Draws the benign document; later cases are compared with it. */
      baseline(setup: AttackSetup): Promise<CaseReport>;
      run(setup: AttackSetup, options?: { settleMs?: number; timeoutMs?: number }): Promise<CaseReport>;
      /** Runs a case whose source the page builds (protocol abuse). */
      protocol(id: string, options?: { timeoutMs?: number }): Promise<CaseReport>;
      heap(): number;
    };
  }
}

const canary: string[] = [];
const policy: string[] = [];

export function installCanary(): void {
  window.__relaxPwned = (id: unknown) => void canary.push(String(id));
  document.addEventListener(
    "securitypolicyviolation",
    (e) => policy.push(`${e.violatedDirective} ${e.blockedURI}${e.sample ? ` "${e.sample}"` : ""}`),
    true,
  );
}

// --- Walking the rendered tree, shadow roots included -------------------------

function* elements(root: Node | null): Generator<Element> {
  if (!root) return;
  const stack: Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node instanceof Element) {
      yield node;
      if (node.shadowRoot) stack.push(node.shadowRoot);
    }
    for (let c = node.lastChild; c; c = c.previousSibling) if (c.nodeType === Node.ELEMENT_NODE) stack.push(c);
  }
}

const tagOf = (el: Element) => `${el.namespaceURI === "http://www.w3.org/2000/svg" ? "svg:" : el.namespaceURI === "http://www.w3.org/1998/Math/MathML" ? "math:" : ""}${el.localName}`;

const URL_ATTRS = new Set(["href", "src", "action", "formaction", "xlink:href", "data", "poster", "background", "ping", "srcset", "codebase", "cite", "longdesc", "manifest", "icon"]);
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const CSS_LOADS = /url\s*\(|expression\s*\(|@import|javascript:/i;
const MARKERS = [PWN_HOST, "__relaxPwned", "relaxident"];

function badUrl(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(v)?.[1];
  return scheme !== undefined && !SAFE_SCHEMES.has(scheme);
}

function escapeKey(el: Element, path: string): string {
  return `${path}${tagOf(el)}${el.getAttribute("class") ? "." + el.getAttribute("class")!.split(/\s+/)[0] : ""}`;
}

/** The element's parent in the flat tree: across a shadow root to its host. */
const parentOf = (el: Element): Element | null => el.parentElement ?? ((el.getRootNode() as ShadowRoot).host as Element | undefined) ?? null;

/**
 * What of the element can be seen: its box, cut by every ancestor up to the
 * host that clips its overflow. `getBoundingClientRect` ignores clipping, so a
 * long label inside an SVG that clips it is not drawn outside anything.
 */
function visibleRect(el: Element, host: HTMLElement): { left: number; top: number; right: number; bottom: number } | null {
  const r = el.getBoundingClientRect();
  let { left, top, right, bottom } = r;
  for (let a = parentOf(el); a && a !== host; a = parentOf(a)) {
    const cs = getComputedStyle(a);
    if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
    const ar = a.getBoundingClientRect();
    if (cs.overflowX !== "visible") {
      left = Math.max(left, ar.left);
      right = Math.min(right, ar.right);
    }
    if (cs.overflowY !== "visible") {
      top = Math.max(top, ar.top);
      bottom = Math.min(bottom, ar.bottom);
    }
  }
  return right - left < 1 || bottom - top < 1 ? null : { left, top, right, bottom };
}

function escapes(root: Node | null, host: HTMLElement): Set<string> {
  const box = host.getBoundingClientRect();
  const out = new Set<string>();
  for (const el of elements(root)) {
    if (el === host) continue;
    const fixed = getComputedStyle(el).position === "fixed";
    const r = visibleRect(el, host);
    if (!r) continue;
    if (fixed || r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) {
      out.add(escapeKey(el, fixed ? "fixed:" : ""));
    }
  }
  return out;
}

function profile(root: Node | null, host: HTMLElement): Profile {
  const tags = new Set<string>();
  const attrs = new Set<string>();
  for (const el of elements(root)) {
    tags.add(tagOf(el));
    for (const a of el.attributes) attrs.add(`${tagOf(el)}@${a.name}`);
  }
  return { tags, attrs, escapes: escapes(root, host) };
}

function describe(el: Element, attr?: Attr): string {
  const v = attr ? `${attr.name}=${JSON.stringify(attr.value.slice(0, 120))}` : "";
  return `<${tagOf(el)}${v ? " " + v : ""}>`;
}

/** What the rendered tree has that the benign document's never had, or should never have. */
function scanDom(root: Node | null, base: Profile): string[] {
  const out: string[] = [];
  for (const el of elements(root)) {
    const tag = tagOf(el);
    if (!base.tags.has(tag)) out.push(`new element ${describe(el)}`);
    if (tag === "style" && MARKERS.some((m) => el.textContent?.includes(m))) out.push(`style element loads ${JSON.stringify(el.textContent!.slice(0, 120))}`);
    for (const a of el.attributes) {
      const name = a.name.toLowerCase();
      if (name.startsWith("on")) out.push(`handler ${describe(el, a)}`);
      else if (!base.attrs.has(`${tag}@${a.name}`)) out.push(`new attribute ${describe(el, a)}`);
      if (URL_ATTRS.has(name) && badUrl(a.value)) out.push(`url ${describe(el, a)}`);
      if (name === "style" && CSS_LOADS.test(a.value)) out.push(`css ${describe(el, a)}`);
      if (name === "srcdoc") out.push(`srcdoc ${describe(el, a)}`);
      if (["style", "class", "slot", "part", "id", "is"].includes(name) && a.value.includes("relaxident")) out.push(`identity ${describe(el, a)}`);
    }
  }
  return out;
}

// --- Globals -----------------------------------------------------------------

const PROTOTYPES: Record<string, () => object | undefined> = {
  Object: () => Object.prototype,
  Array: () => Array.prototype,
  Function: () => Function.prototype,
  String: () => String.prototype,
  Number: () => Number.prototype,
  Boolean: () => Boolean.prototype,
  RegExp: () => RegExp.prototype,
  Promise: () => Promise.prototype,
  Map: () => Map.prototype,
  Set: () => Set.prototype,
  Node: () => Node.prototype,
  Element: () => Element.prototype,
  HTMLElement: () => HTMLElement.prototype,
  EventTarget: () => EventTarget.prototype,
  Document: () => Document.prototype,
  "gen-ui": () => customElements.get("gen-ui")?.prototype,
};

function globals(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, get] of Object.entries(PROTOTYPES)) {
    const p = get();
    if (p) out.set(name, Reflect.ownKeys(p).map(String).sort().join(","));
  }
  out.set("window", Object.getOwnPropertyNames(window).sort().join(","));
  return out;
}

function globalChanges(before: Map<string, string>, after: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [name, now] of after) {
    const was = before.get(name);
    if (was === now) continue;
    const a = new Set(was?.split(",") ?? []);
    const added = now.split(",").filter((k) => !a.has(k));
    const b = new Set(now.split(","));
    const removed = [...a].filter((k) => !b.has(k));
    out.push(`${name}: ${added.length ? `+${added.slice(0, 5).join(" +")}` : ""}${removed.length ? ` -${removed.slice(0, 5).join(" -")}` : ""}`.trim());
  }
  // A polluted property shows on every object, whatever its key.
  for (const key of ["polluted", "relaxPolluted"]) if (key in {}) out.push(`({}).${key} is set`);
  return out;
}

// --- Running a case ------------------------------------------------------------

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function installAttacks(adapter: AttackAdapter): void {
  installCanary();
  let base: Profile | undefined;

  async function once(setup: AttackSetup, settleMs: number, timeoutMs: number, compare: boolean, build?: ProtocolBuild): Promise<CaseReport> {
    const host = document.getElementById("host")!;
    host.replaceChildren();
    const before = globals();
    canary.length = 0;
    policy.length = 0;
    let gap = 0;
    let running = true;
    let last = performance.now();
    const tick = (t: number) => {
      gap = Math.max(gap, t - last);
      last = t;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const start = performance.now();
    const mount = await adapter.attack(host, setup);
    let timedOut = false;
    let settledAt = 0;
    void build?.during?.(mount);
    const settled = await Promise.race([
      mount.settled().then((s) => ((settledAt = performance.now()), s)),
      sleep(timeoutMs).then(() => {
        timedOut = true;
        return { status: "timeout", refused: 0 } as Settled;
      }),
    ]);
    const ms = performance.now() - start;
    // Handlers fire after a failed load or a focus: give them time.
    await frame();
    await sleep(settleMs);
    await frame();
    running = false;
    const surface = mount.surface();
    const report: CaseReport = {
      ...settled,
      ...(timedOut ? { timedOut } : {}),
      ms,
      ...(build?.marks.bad !== undefined && settledAt ? { failClosedMs: Math.max(0, settledAt - build.marks.bad) } : {}),
      maxFrameGap: gap,
      text: (surface?.textContent ?? "").slice(0, 20_000),
      evidence: { ...noEvidence(), canary: [...canary], policy: [...policy] },
    };
    if (compare && base) {
      report.evidence.dom = scanDom(surface, base);
      report.evidence.bounds = [...escapes(surface, host)].filter((k) => !base!.escapes.has(k));
    } else {
      base = profile(surface, host);
    }
    report.evidence.globals = globalChanges(before, globals());
    delete (report.evidence as Partial<Evidence>).requests;
    mount.unmount();
    host.replaceChildren();
    return report;
  }

  window.__attack = {
    ready: true,
    baseline: (setup) => once(setup, 300, 15_000, false),
    run: (setup, o = {}) => once(setup, o.settleMs ?? 300, o.timeoutMs ?? 15_000, true),
    protocol: (id, o = {}) => {
      const build = buildProtocolCase(id);
      return once(build.setup, 100, o.timeoutMs ?? 30_000, true, build);
    },
    heap: () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0,
  };
}
