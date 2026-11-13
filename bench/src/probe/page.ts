import { attackFromMount } from "../attacks/contender.ts";
import { installAttacks, type AttackAdapter } from "../attacks/page.ts";

/**
 * The in-page half of the harness (plan D3, D4), identical for every renderer.
 *
 * - A scheduler feeds a step's encoded frames to the adapter at the step's
 *   rate, so the network plays no part: the renderer is what is measured.
 * - A probe records requestAnimationFrame deltas, long animation frames and
 *   event timing while the frames stream, and when the first node appeared.
 * - When the renderer reports done, its output is compared with the reference
 *   drawing of the complete document (R1: a fast wrong answer is a break).
 */

export interface Mounted {
  push(chunk: string): void;
  end(): void;
  /** Resolves when the renderer has drawn the complete document. */
  done(): Promise<void>;
  /** The rendered document's root element, for the correctness check. */
  root(): Element | null;
  unmount(): void;
  /**
   * A new document into the same mounted renderer, as a page already showing
   * generated UI receives the next one. Ladders measure this; mounting is
   * measured once, as cold start.
   */
  next?(): Promise<Mounted>;
}

export interface PageAdapter {
  id: string;
  mount(host: HTMLElement): Promise<Mounted>;
  /** The canonical markup the complete document should produce. */
  reference(document: unknown): string;
  /** Framework components mounted right now, for a renderer that mounts them (soak). */
  mountedComponents?(): number;
  /** How many framework components `document` should have mounted (soak). */
  expectedComponents?(document: unknown): number;
  /**
   * The contender's own elements between the document's: host elements a
   * framework puts around each component (A2UI's `<a2ui-react-card>`, a Lit
   * or Angular host). The comparison reads through them; the timing keeps
   * them, since the page pays for them.
   */
  unwrap?(element: Element): boolean;
  /** One attack case in a fresh renderer (phase 5); pages with it can be attacked. */
  attack?: AttackAdapter["attack"];
}

/**
 * A soak's documents (FR-415): each streamed as frames of patches into the
 * same mounted renderer, each replacing the last, round and round. The run
 * pauses for a sample only after document 0 is complete, so every sample sees
 * the same document on the page.
 */
export interface SoakData {
  documents: { chunks: string[]; final: unknown }[];
  rateMs: number;
}

export interface SoakPause {
  /** Documents rendered so far. */
  documents: number;
  mounted?: number;
  expectedMounted?: number;
}

export interface StepData {
  chunks: string[];
  final: unknown;
  rateMs: number;
  /**
   * A small document using every component, rendered and discarded before the
   * measured run, so the run measures load, not the page's cold start (code
   * loading, validator construction, JIT). Absent for the cold-start run.
   */
  warmup?: string[];
}

/** Frames are sampled for at least this long, so one hiccup in a short run is not a 95th percentile. */
const MIN_WINDOW_MS = 1_000;

export interface PageSample {
  frames: number[];
  longFrames: number[];
  interaction: number;
  firstNode: number;
  complete: number;
  correct: boolean;
  detail?: string;
}

declare global {
  interface Window {
    __bench: {
      pushed: number;
      total: number;
      ready: boolean;
      load(url: string): Promise<void>;
      run(): Promise<PageSample>;
      soak: {
        start(url: string): Promise<void>;
        /** Resolves at the next pause point: document 0 complete. */
        pause(): Promise<SoakPause>;
        resume(): void;
        /** Stops after the current document and unmounts. */
        stop(): Promise<void>;
      };
    };
  }
}

export function installHarness(adapter: PageAdapter): void {
  // A contender's page is attacked through its ordinary mount (T-445).
  installAttacks({ attack: adapter.attack ?? attackFromMount((host) => adapter.mount(host)) });
  let data: StepData | undefined;
  const bench: Window["__bench"] = {
    pushed: 0,
    total: 0,
    ready: true,
    async load(url) {
      data = (await (await fetch(url)).json()) as StepData;
      bench.total = data.chunks.length;
    },
    async run() {
      if (!data) throw new Error("no step loaded");
      const host = document.getElementById("host")!;
      let mounted: Mounted;
      // Where the run begins: before the mount for cold start, after the
      // warm-up for a ladder step.
      let begin = performance.now();
      if (data.warmup) {
        const warm = await adapter.mount(host);
        for (const chunk of data.warmup) warm.push(chunk);
        warm.end();
        await warm.done();
        await new Promise((r) => setTimeout(r, 100));
        begin = performance.now();
        if (warm.next) {
          mounted = await warm.next();
        } else {
          warm.unmount();
          host.replaceChildren();
          mounted = await adapter.mount(host);
        }
      } else {
        mounted = await adapter.mount(host);
      }

      const longFrames: number[] = [];
      const events: number[] = [];
      // Entries arrive after their frame ends, so a long frame of the warm-up
      // (lazy component code, the first style pass) can be delivered after
      // this observer starts. Only frames that began in the run are the run's.
      const lof = new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { blockingDuration?: number })[]) {
          if (e.startTime < begin) continue;
          // A long animation frame is a long task only if something in it
          // blocked: a frame stretched by idle time (an input dispatched by the
          // test driver, say) has a blocking duration of zero.
          if (e.blockingDuration === 0) continue;
          longFrames.push(e.duration);
        }
      });
      try {
        lof.observe({ type: "long-animation-frame" });
      } catch {
        lof.observe({ type: "longtask" });
      }
      const evo = new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEventTiming & { interactionId?: number })[]) {
          if (e.interactionId && e.startTime >= begin) events.push(e.duration);
        }
      });
      evo.observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);

      const frames: number[] = [];
      const start = performance.now();
      let last = start;
      let firstNode = -1;
      let running = true;
      const tick = (t: number) => {
        frames.push(t - last);
        last = t;
        if (firstNode < 0 && mounted.root()) firstNode = t - start;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      for (const chunk of data.chunks) {
        mounted.push(chunk);
        bench.pushed++;
        await new Promise((r) => setTimeout(r, data!.rateMs));
      }
      mounted.end();
      await mounted.done();
      const complete = performance.now() - start;
      // One more frame, so the last paint is counted; then keep sampling to
      // the minimum window.
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      while (performance.now() - start < MIN_WINDOW_MS) await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      running = false;
      lof.disconnect();
      evo.disconnect();

      const got = canonical(mounted.root(), adapter.unwrap);
      const want = adapter.reference(data.final);
      return {
        // The first delta spans the time before the run began.
        frames: frames.slice(1),
        longFrames,
        interaction: events.length ? Math.max(...events) : 0,
        firstNode: firstNode < 0 ? complete : firstNode,
        complete,
        correct: got === want,
        ...(got === want ? {} : { detail: firstDifference(got, want) }),
      };
    },
    soak: soakLoop(adapter),
  };
  window.__bench = bench;
}

function soakLoop(adapter: PageAdapter): Window["__bench"]["soak"] {
  let soak: SoakData;
  let stopping = false;
  let stopped: Promise<void> = Promise.resolve();
  let pauseAt: ((p: SoakPause) => void) | undefined;
  let resumed: (() => void) | undefined;

  async function loop() {
    const host = document.getElementById("host")!;
    let mounted: Mounted | undefined;
    for (let i = 0; !stopping; i++) {
      const doc = soak.documents[i % soak.documents.length]!;
      if (!mounted) mounted = await adapter.mount(host);
      else if (mounted.next) mounted = await mounted.next();
      else {
        mounted.unmount();
        host.replaceChildren();
        mounted = await adapter.mount(host);
      }
      for (const chunk of doc.chunks) {
        mounted.push(chunk);
        await new Promise((r) => setTimeout(r, soak.rateMs));
      }
      mounted.end();
      await mounted.done();
      if (i % soak.documents.length === 0 && pauseAt) {
        const report = pauseAt;
        pauseAt = undefined;
        const wait = new Promise<void>((r) => (resumed = r));
        report({
          documents: i + 1,
          ...(adapter.mountedComponents ? { mounted: adapter.mountedComponents() } : {}),
          ...(adapter.expectedComponents ? { expectedMounted: adapter.expectedComponents(doc.final) } : {}),
        });
        await wait;
      }
    }
    mounted?.unmount();
    host.replaceChildren();
  }

  return {
    async start(url) {
      soak = (await (await fetch(url)).json()) as SoakData;
      stopping = false;
      stopped = loop();
    },
    pause: () => new Promise<SoakPause>((r) => (pauseAt = r)),
    resume: () => {
      resumed?.();
      resumed = undefined;
    },
    async stop() {
      stopping = true;
      pauseAt = undefined;
      resumed?.();
      await stopped;
    },
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Elements, sorted attributes and text, in order (as the cross-host test).
 * Text is what renders: runs of text nodes are one text, whatever comments
 * (a template library's markers) or unwrapped elements sit between them. An
 * SVG element is marked as one, so an element made in the wrong namespace,
 * which draws nothing, does not pass for the right one.
 */
export function canonical(root: Element | null, unwrap?: (element: Element) => boolean): string {
  if (!root) return "";
  const out: string[] = [];
  let text = "";
  const flush = () => {
    if (text !== "") out.push(JSON.stringify(text));
    text = "";
  };
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node as Text).data;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (unwrap?.(el)) {
      for (const child of el.childNodes) walk(child);
      return;
    }
    flush();
    const name = `${el.namespaceURI === SVG_NS ? "svg:" : ""}${el.localName}`;
    const attrs = [...el.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort();
    out.push(`<${name}${attrs.length ? " " + attrs.join(" ") : ""}>`);
    for (const child of el.childNodes) walk(child);
    flush();
    out.push(`</${name}>`);
  };
  walk(root);
  flush();
  return out.join("\n");
}

function firstDifference(a: string, b: string): string {
  const x = a.split("\n");
  const y = b.split("\n");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return `line ${i}: got ${x[i]?.slice(0, 120)} want ${y[i]?.slice(0, 120)} (lengths ${x.length}/${y.length})`;
  }
  return "";
}
