/**
 * A deliberately unsafe renderer (T-440): what the attack harness must catch.
 * It reads the same SSE route and draws each node the way no renderer should:
 * string props as HTML, `href` as given, a `style` prop applied, and props
 * merged into shared defaults by a naive deep merge. Every evidence kind has a
 * payload that this page lets through; the self-test asserts each is seen.
 * Never used as a contender.
 */
import type { AttackSetup, Settled } from "../src/attacks/page.ts";
import { installHarness } from "../src/probe/page.ts";

const defaults: Record<string, unknown> = {};

function merge(into: Record<string, unknown>, from: Record<string, unknown>) {
  for (const key in from) {
    const v = from[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (!into[key] || typeof into[key] !== "object") into[key] = {};
      merge(into[key] as Record<string, unknown>, v as Record<string, unknown>);
    } else into[key] = v;
  }
}

interface N {
  type: string;
  props: Record<string, unknown>;
  children?: N[];
}

function draw(node: N): HTMLElement {
  const el = document.createElement("div");
  merge(defaults, node.props);
  for (const [k, v] of Object.entries(node.props)) {
    if (typeof v !== "string") continue;
    if (k === "style") el.setAttribute("style", v);
    else if (k === "href") el.insertAdjacentHTML("beforeend", `<a href="${v}">link</a>`);
    else el.insertAdjacentHTML("beforeend", v);
  }
  for (const c of node.children ?? []) el.append(draw(c));
  return el;
}

async function read(setup: AttackSetup): Promise<N | undefined> {
  const url = (setup.source as { url?: string }).url;
  if (!url) return undefined;
  const body = await (await fetch(url, { method: "POST" })).text();
  for (const block of body.split("\n\n")) {
    const data = block.replace(/^data: /, "");
    try {
      const e = JSON.parse(data) as { type: string; value?: { root: N } };
      if (e.type === "complete") return e.value?.root;
    } catch {
      // not an event
    }
  }
  return undefined;
}

installHarness({
  id: "attack-unsafe",
  reference: () => "",
  async mount() {
    throw new Error("attack-unsafe only runs attack cases");
  },
  async attack(host, setup) {
    const surface = document.createElement("div");
    host.replaceChildren(surface);
    const settled: Promise<Settled> = read(setup).then((root) => {
      if (root) surface.append(draw(root));
      return { status: "complete", refused: 0 };
    });
    return { settled: () => settled, surface: () => surface, unmount: () => surface.remove() };
  },
});
