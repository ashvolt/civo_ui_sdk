/* The dashboard's figures, drawn from the inlined results (dashboard/build.mjs).
   Every name and number reaches the page through textContent or attributes,
   never as markup. */
"use strict";

const DATA = JSON.parse(document.getElementById("data").textContent);
const app = document.getElementById("app");
const tip = document.getElementById("tooltip");
const SVG = "http://www.w3.org/2000/svg";

// --- Small DOM helpers ---------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) n.append(c instanceof Node ? c : String(c));
  return n;
}

function sv(tag, attrs = {}, ...children) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) n.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-GB") : n);
const compact = (n) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 && n % 1000 === 0 ? `${n / 1000}K` : fmt(n));
const pct = (x) => `${Math.round(x * 100)}%`;
const mb = (bytes) => Math.round((bytes / 1_048_576) * 100) / 100;

function card(title, sub, repro, ...body) {
  return el(
    "section",
    { class: "card" },
    el("div", { class: "card-head" }, el("div", {}, el("h2", {}, title), sub ? el("p", { class: "note" }, sub) : null), repro ? el("div", { class: "repro" }, "Reproduce: ", el("code", {}, repro)) : null),
    ...body,
  );
}

// --- Tooltip -------------------------------------------------------------------

function showTip(x, y, title, rows) {
  tip.replaceChildren(el("div", { class: "t-title" }, title));
  for (const r of rows) {
    tip.append(el("div", { class: "t-row" }, r.color ? el("span", { class: "key-line", style: `background:${r.color}` }) : null, el("strong", {}, r.value), el("span", {}, r.label)));
  }
  tip.hidden = false;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = Math.min(window.innerWidth - w - 8, x + 14);
  const top = y + h + 20 > window.innerHeight ? y - h - 14 : y + 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
const hideTip = () => (tip.hidden = true);

// --- Renderers and their colours ----------------------------------------------

const NAMES = {
  "ours-element": "This SDK, element",
  "ours-react": "This SDK, React hook",
  "ours-vue-host": "This SDK, in Vue",
  "ours-angular-host": "This SDK, in Angular",
  "json-render": "json-render",
  openui: "OpenUI",
  "ai-sdk": "AI SDK",
  "a2ui-lit": "A2UI, Lit",
  "a2ui-react": "A2UI, React",
  "a2ui-angular": "A2UI, Angular",
  "ours-bootstrap": "Element + Bootstrap 5",
  "ours-shoelace": "Element + Shoelace",
  "ours-element-plus": "Element + Element Plus",
  "ours-material": "Element + Angular Material",
  "ours-mui": "Element + MUI",
  "ours-connect-react": "Element + React connector",
};
const nameOf = (id) => NAMES[id] ?? id;

/** Two small multiples, each with its renderers in fixed slots of the categorical palette. */
const GROUPS = [
  { title: "This SDK's element against the contenders", ids: ["ours-element", "json-render", "openui", "ai-sdk", "a2ui-lit", "a2ui-react", "a2ui-angular"] },
  { title: "This SDK in each host", ids: ["ours-element", "ours-react", "ours-vue-host", "ours-angular-host"] },
];
const slot = (i) => `var(--series-${i + 1})`;

const WORKLOADS = {
  nodes: "Nodes streamed in 20 frames",
  "static-nodes": "Nodes arriving in one frame",
  depth: "Nesting depth",
  "table-cells": "Cells in one table, streamed",
  "chart-points": "Points in one chart, streamed",
  "frame-rate": "Frames per second, 500 nodes",
  "text-churn": "Share of text rewritten per frame",
  "tone-density": "Share of nodes with a tone",
  "heatmap-cells": "Cells in one heatmap",
  "scatter-points": "Points in one scatter",
  sparklines: "Sparklines of 30 points",
  counters: "Animated counters, every value changing",
};

const METRICS = {
  frameP95: { label: "Frame interval, p95", unit: "ms", budget: () => DATA.budgets.frameP95 },
  longestTask: { label: "Longest task", unit: "ms", budget: () => DATA.budgets.longestTask },
  interaction: { label: "Interaction latency", unit: "ms", budget: () => DATA.budgets.interaction },
  complete: { label: "Time to complete", unit: "ms", budget: () => undefined },
};

const state = { profile: "desktop", workload: "nodes", metric: "frameP95" };

// --- Line chart ------------------------------------------------------------------

/**
 * Lines over ordinal steps, one y-axis, an optional budget line, a crosshair
 * that snaps to a step (pointer and arrow keys) with one tooltip for every
 * series. A series stops at its broken step, which gets a hollow marker.
 */
function lineChart({ series, xLabels, budget, unit, label, title, xTitle = "step size" }) {
  const W = 560;
  const H = 260;
  const m = { top: 14, right: 16, bottom: 34, left: 48 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const values = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => typeof v === "number");
  const top = niceMax(Math.max(budget ?? 0, ...values, 1));
  const x = (i) => m.left + (xLabels.length === 1 ? iw / 2 : (i / (xLabels.length - 1)) * iw);
  const y = (v) => m.top + ih - (Math.min(v, top) / top) * ih;
  const ticks = [0, top / 4, top / 2, (3 * top) / 4, top];

  const root = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${title}: ${label}, by step` });
  for (const t of ticks) {
    root.append(sv("line", { class: "gridline", x1: m.left, x2: W - m.right, y1: y(t), y2: y(t) }));
    root.append(sv("text", { x: m.left - 6, y: y(t) + 4, "text-anchor": "end" }, top < 10 ? t.toFixed(1) : compact(Math.round(t))));
  }
  // At most about ten labels along the axis; the crosshair reads the rest.
  const every = Math.ceil(xLabels.length / 10);
  xLabels.forEach((l, i) => i % every === 0 && root.append(sv("text", { x: x(i), y: H - m.bottom + 16, "text-anchor": "middle" }, compact(l))));
  root.append(sv("text", { x: m.left + iw / 2, y: H - 2, "text-anchor": "middle" }, xTitle));
  if (budget !== undefined && budget <= top) {
    root.append(sv("line", { class: "budget", x1: m.left, x2: W - m.right, y1: y(budget), y2: y(budget) }));
    root.append(sv("text", { class: "budget-label", x: W - m.right, y: y(budget) - 4, "text-anchor": "end" }, `budget ${budget} ${unit}`));
  }
  for (const s of series) {
    const pts = s.points.filter((p) => typeof p.y === "number");
    if (!pts.length) continue;
    root.append(sv("polyline", { points: pts.map((p) => `${x(p.i)},${y(p.y)}`).join(" "), fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    const last = pts.at(-1);
    root.append(
      sv("circle", {
        cx: x(last.i),
        cy: y(last.y),
        r: 4,
        fill: last.broken ? "var(--surface-1)" : s.color,
        stroke: last.broken ? s.color : "var(--surface-1)",
        "stroke-width": 2,
      }),
    );
  }
  const cross = sv("line", { class: "crosshair", y1: m.top, y2: m.top + ih, visibility: "hidden" });
  root.append(cross);

  const wrap = el("div", { class: "chart", tabindex: 0, "aria-label": `${title}. Use the arrow keys to read each step.` }, root);
  let at = -1;
  const read = (i, cx, cy) => {
    at = i;
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    const rows = series.map((s) => {
      const p = s.points.find((q) => q.i === i);
      const value = p?.y === undefined ? "—" : `${fmt(p.y)} ${unit}`;
      return { color: s.color, value, label: `${s.name}${p?.broken ? ` · broke: ${p.broken}` : ""}` };
    });
    showTip(cx, cy, `${title} · ${xTitle} ${fmt(xLabels[i])}`, rows);
  };
  const off = () => {
    at = -1;
    cross.setAttribute("visibility", "hidden");
    hideTip();
  };
  root.addEventListener("pointermove", (e) => {
    const r = root.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(xLabels.length - 1, Math.round(((px - m.left) / iw) * (xLabels.length - 1))));
    read(i, e.clientX, e.clientY);
  });
  root.addEventListener("pointerleave", off);
  wrap.addEventListener("blur", off);
  wrap.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = Math.max(0, Math.min(xLabels.length - 1, (at === -1 ? 0 : at) + (e.key === "ArrowRight" ? 1 : -1)));
    const r = wrap.getBoundingClientRect();
    read(next, r.left + (x(next) / W) * r.width, r.top + 20);
  });
  return wrap;
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

function legend(items, kind = "line") {
  return el(
    "div",
    { class: "legend" },
    items.map((it) => el("span", {}, el("span", { class: kind === "line" ? "key-line" : "key-box", style: `background:${it.color}` }), it.label)),
  );
}

// --- Sections --------------------------------------------------------------------

const compareData = DATA.compare;
const ladderOf = (renderer, workload, profile) => compareData?.ladders.find((l) => l.renderer === renderer && l.workload === workload && l.profile === profile);
const workloadOf = (id) => compareData?.workloads.find((w) => w.id === id);

function breakLabel(l) {
  if (!l) return "—";
  if (l.breakPoint === "not-reached") return "all";
  if (l.breakPoint === "below-first-step") return "none";
  if (l.breakPoint === "not-expressible") return "n/e";
  return compact(l.breakPoint);
}

/** 0 for none or n/e, 1–6 by how far up the ladder the renderer got. */
function bucket(l) {
  const w = workloadOf(l?.workload);
  if (!l || !w || l.breakPoint === "below-first-step" || l.breakPoint === "not-expressible") return 0;
  if (l.breakPoint === "not-reached") return 6;
  const i = w.steps.indexOf(l.breakPoint) + 1;
  return Math.max(1, Math.min(6, Math.ceil((i / w.steps.length) * 6)));
}

function summaryTiles() {
  const tiles = el("div", { class: "tiles" });
  const a = DATA.attacks;
  if (a) {
    const ours = a.rows.filter((r) => r.renderer.startsWith("ours-"));
    const cases = ours.reduce((s, r) => s + r.blocked + r.inert + r.executed, 0) + a.protocol.cases;
    const executed = ours.reduce((s, r) => s + r.executed, 0);
    tiles.append(
      el("div", { class: "tile hero" }, el("div", { class: "label" }, "Attacks that ran in this SDK"), el("div", { class: `value ${executed ? "status-bad" : ""}` }, fmt(executed)), el("div", { class: "sub" }, `of ${fmt(cases)} cases on ${new Set(ours.map((r) => r.renderer)).size} hosts`)),
      el("div", { class: "tile" }, el("div", { class: "label" }, "Protocol requirements met"), el("div", { class: "value" }, `${a.protocol.passed} of ${a.protocol.cases}`), el("div", { class: "sub" }, "malformed, truncated, oversized and flooded streams")),
    );
  }
  const t = DATA.redteam;
  if (t && !t.skipped) {
    tiles.append(el("div", { class: "tile" }, el("div", { class: "label" }, "Red-team leak rate"), el("div", { class: "value" }, pct(t.leaks / t.total)), el("div", { class: "sub" }, `${fmt(t.total)} runs on local models; attempted in ${pct(t.attempts / t.total)}`)));
  }
  const s = DATA.soak;
  if (s) {
    const growth = Math.max(...s.runs.map((r) => r.verdict.heapGrowth));
    tiles.append(el("div", { class: "tile" }, el("div", { class: "label" }, "Largest heap growth, 30-minute soak"), el("div", { class: "value" }, `${(growth * 100).toFixed(1)}%`), el("div", { class: "sub" }, `budget 10%; ${s.runs.every((r) => r.verdict.domNodeGrowth <= 0 && r.verdict.listenerGrowth <= 0 && r.verdict.detachedGrowth <= 0) ? "DOM, listeners and detached nodes flat" : "DOM, listeners or detached nodes grew"}`)));
  }
  return tiles;
}

function filters() {
  const seg = el("div", { class: "segmented", role: "group", "aria-label": "Profile" });
  for (const [id, label] of [["desktop", "Desktop"], ["phone", "Phone (CPU 4×)"]]) {
    seg.append(el("button", { type: "button", "aria-pressed": state.profile === id ? "true" : "false", onclick: () => ((state.profile = id), render()) }, label));
  }
  return el("div", { class: "filters" }, el("span", { class: "note" }, "Profile"), seg);
}

function breakPoints() {
  if (!compareData) return null;
  const renderers = [...GROUPS[1].ids, ...GROUPS[0].ids.slice(1)];
  const head = el(
    "tr",
    {},
    el("th", { scope: "col" }, "Workload"),
    renderers.map((r) => el("th", { scope: "col", class: "num" }, nameOf(r))),
  );
  const body = compareData.workloads.map((w) =>
    el(
      "tr",
      {},
      el("th", { scope: "row" }, el("div", {}, w.id), el("div", { class: "note" }, WORKLOADS[w.id] ?? "")),
      renderers.map((r) => {
        const l = ladderOf(r, w.id, state.profile);
        const why = !l ? "not run" : l.breakPoint === "not-expressible" ? "not expressible in its format" : l.breakPoint === "not-reached" ? "passed every step" : l.breakPoint === "below-first-step" ? `broke at the first step (${l.brokenBy})` : `passed ${fmt(l.breakPoint)}; next step broke (${l.brokenBy})`;
        const text = `${nameOf(r)} · ${w.id} · ${state.profile}: ${why}`;
        const show = (cx, cy) => showTip(cx, cy, `${nameOf(r)} · ${w.id}`, [{ value: breakLabel(l), label: why }]);
        return el(
          "td",
          {
            class: `bp b${bucket(l)}`,
            tabindex: 0,
            "aria-label": text,
            onpointermove: (e) => show(e.clientX, e.clientY),
            onpointerleave: hideTip,
            onfocus: (e) => {
              const b = e.target.getBoundingClientRect();
              show(b.right, b.top);
            },
            onblur: hideTip,
            onclick: () => {
              state.workload = w.id;
              render();
              document.getElementById("curves")?.scrollIntoView({ behavior: "smooth" });
            },
          },
          breakLabel(l),
        );
      }),
    ),
  );
  const ramp = el("span", { class: "key-ramp" }, [0, 1, 2, 3, 4, 5, 6].map((b) => el("span", { class: `key-box b${b}` })));
  return card(
    "Break points",
    `The largest step each renderer passed within every budget (frame interval p95 ${DATA.budgets.frameP95} ms, longest task ${DATA.budgets.longestTask} ms, interaction ${DATA.budgets.interaction} ms), on the ${state.profile} profile. "all": every step; "none": not even the first; "n/e": the format cannot express the workload. A difference of one step is noise. Select a cell for its curves.`,
    `pnpm --filter relax-ui-bench bench -- --profile ${state.profile}`,
    el("div", { class: "legend" }, el("span", {}, "none"), ramp, el("span", {}, "all steps")),
    el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, head), el("tbody", {}, body))),
  );
}

function curves() {
  if (!compareData) return null;
  const w = workloadOf(state.workload);
  const metric = METRICS[state.metric];
  const select = el(
    "select",
    { "aria-label": "Workload", onchange: (e) => ((state.workload = e.target.value), render()) },
    compareData.workloads.map((x) => el("option", { value: x.id, selected: x.id === state.workload }, `${x.id} — ${WORKLOADS[x.id] ?? ""}`)),
  );
  const seg = el("div", { class: "segmented", role: "group", "aria-label": "Metric" });
  for (const [id, m] of Object.entries(METRICS)) seg.append(el("button", { type: "button", "aria-pressed": state.metric === id ? "true" : "false", onclick: () => ((state.metric = id), render()) }, m.label));

  const charts = GROUPS.map((g) => {
    const series = g.ids.map((id, i) => {
      const l = ladderOf(id, w.id, state.profile);
      return {
        name: nameOf(id),
        color: slot(i),
        points: (l?.steps ?? []).map((s) => ({ i: w.steps.indexOf(s.size), y: s[state.metric], broken: s.broken })),
      };
    });
    return el(
      "div",
      {},
      el("h3", {}, g.title),
      legend(series.map((s) => ({ color: s.color, label: s.name }))),
      lineChart({ series, xLabels: w.steps, budget: metric.budget(), unit: metric.unit, label: metric.label, title: g.title }),
    );
  });

  const allIds = [...new Set(GROUPS.flatMap((g) => g.ids))];
  const table = el(
    "table",
    {},
    el("thead", {}, el("tr", {}, el("th", {}, "Renderer"), w.steps.map((s) => el("th", { class: "num" }, compact(s))))),
    el(
      "tbody",
      {},
      allIds.map((id) => {
        const l = ladderOf(id, w.id, state.profile);
        return el(
          "tr",
          {},
          el("th", { scope: "row" }, nameOf(id)),
          w.steps.map((size) => {
            const s = l?.steps.find((x) => x.size === size);
            return el("td", { class: "num" }, s?.[state.metric] === undefined ? "" : `${fmt(s[state.metric])}${s.broken ? " ✕" : ""}`);
          }),
        );
      }),
    ),
  );
  const desc = `${WORKLOADS[w.id] ?? w.id}. Steps ${w.steps.map(compact).join(", ")}${w.frames ? `; ${w.frames} frames` : ""}${w.rate ? ` at ${w.rate} per second` : ""}; seed ${w.seed}. Defined in bench/src/workloads/ladders.ts.`;
  return el(
    "div",
    { id: "curves" },
    card(
      "Ladder curves",
      `${metric.label}, median of five runs per step, on the ${state.profile} profile. Each line stops at the step that broke (hollow marker).`,
      `pnpm --filter relax-ui-bench bench -- --workload ${w.id} --profile ${state.profile}`,
      el("div", { class: "filters" }, select, seg),
      el("p", { class: "note" }, desc),
      el("div", { class: "charts" }, charts),
      el("details", {}, el("summary", {}, `Table: ${metric.label} (${metric.unit}) by step; ✕ marks the step that broke`), el("div", { class: "table-wrap" }, table)),
    ),
  );
}

function coldStart() {
  if (!compareData?.coldStart.length) return null;
  const rows = compareData.coldStart.filter((c) => c.profile === state.profile);
  return card(
    "Cold start",
    `The twelve-component document in a fresh page, nothing loaded yet: what a user pays once per page. Median ms, ${state.profile} profile.`,
    `pnpm --filter relax-ui-bench bench -- --workload nodes --profile ${state.profile}`,
    el(
      "div",
      { class: "table-wrap" },
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, el("th", {}, "Renderer"), el("th", { class: "num" }, "First node"), el("th", { class: "num" }, "Complete"), el("th", { class: "num" }, "Longest task"))),
        el("tbody", {}, rows.map((c) => el("tr", {}, el("th", { scope: "row" }, nameOf(c.renderer)), el("td", { class: "num" }, fmt(c.firstNode)), el("td", { class: "num" }, fmt(c.complete)), el("td", { class: "num" }, fmt(c.longestTask))))),
      ),
    ),
  );
}

function soak() {
  const s = DATA.soak;
  if (!s) return null;
  const SOAK_NAMES = { "ours-element": "This SDK, element", "ours-react": "This SDK, React hook", "ours-connect-react": "Element with a React connector" };
  const charts = s.runs.map((r) => {
    const sorted = (xs) => xs.slice().sort((a, b) => a - b);
    const first = sorted(r.series.slice(0, r.windowStart).map((p) => p.heap))[Math.floor(Math.min(r.windowStart, r.series.length) / 2)];
    const series = [{ name: "heap after GC", color: slot(0), points: r.series.map((p, i) => ({ i, y: mb(p.heap) })) }];
    const last = r.series.at(-1);
    return el(
      "div",
      {},
      el("h3", {}, SOAK_NAMES[r.renderer] ?? r.renderer),
      el(
        "p",
        { class: "note" },
        `${r.passed ? "Passed" : "Failed"}: heap grew ${(r.verdict.heapGrowth * 100).toFixed(1)}% (median of the last ${r.windowStart} minutes over the first ${r.windowStart}); DOM nodes ${fmt(r.series[0].domNodes)} → ${fmt(last.domNodes)}; listeners ${fmt(r.series[0].listeners)} → ${fmt(last.listeners)}; detached DOM ${r.detachedStart} → ${r.detachedEnd}${last.mounted !== undefined ? `; mounted components ${last.mounted} of ${last.expectedMounted}` : ""}.`,
      ),
      lineChart({ series, xLabels: r.series.map((p) => Math.round(p.minute)), budget: mb(first * 1.1), unit: "MB", label: "Heap after GC, MB", title: `${SOAK_NAMES[r.renderer] ?? r.renderer}, heap by minute`, xTitle: "minute" }),
    );
  });
  return card(
    "Soak",
    "Thirty minutes of documents replaced and patched in one mounted renderer, sampled each minute after garbage collection. Heap growth is the median of the last five minutes over the first five; the budget line is 10% above the first five minutes.",
    "pnpm --filter relax-ui-bench bench:soak",
    el("div", { class: "charts" }, charts),
  );
}

const TIER = { full: "full validation", server: "server tier", own: "as shipped" };

function attacks() {
  const a = DATA.attacks;
  if (!a) return null;
  const colors = { blocked: "var(--series-1)", inert: "var(--series-3)", executed: "var(--critical)" };
  const rows = a.rows.map((r) => {
    const total = r.blocked + r.inert + r.executed;
    const bar = el(
      "div",
      { class: "seg-bar", role: "img", "aria-label": `${r.blocked} blocked, ${r.inert} inert, ${r.executed} executed` },
      ["blocked", "inert", "executed"].filter((k) => r[k]).map((k) => el("span", { style: `flex:${r[k]} 0 0;background:${colors[k]}` })),
    );
    const contender = !r.renderer.startsWith("ours-");
    const executed =
      r.executed === 0
        ? el("td", { class: "num" }, "0")
        : el("td", { class: "num status-bad" }, `✕ ${r.executed}${contender && r.passedThrough === r.executed ? " ¹" : ""}`);
    return el(
      "tr",
      {},
      el("th", { scope: "row" }, nameOf(r.renderer)),
      el("td", {}, TIER[r.tier] ?? r.tier),
      el("td", {}, r.connector),
      el("td", {}, bar),
      el("td", { class: "num" }, fmt(r.blocked)),
      el("td", { class: "num" }, fmt(r.inert)),
      executed,
      el("td", { class: "num" }, fmt(total)),
    );
  });
  return card(
    "Attacks",
    `The injection corpus, ${a.fuzz?.count ?? 0} fuzzed variants (seed ${a.fuzz?.seed}) and the injection tricks, each in every string prop of every component; decided by evidence (a canary call, a policy violation, forbidden DOM, a request leaving the page, a changed global, an element outside its box). Protocol abuse: ${a.protocol.passed} of ${a.protocol.cases} requirements met.`,
    `pnpm --filter relax-ui-bench bench:attacks -- --seed ${a.fuzz?.seed}`,
    legend([
      { color: colors.blocked, label: "blocked: refused by validation" },
      { color: colors.inert, label: "inert: drawn, nothing ran" },
      { color: colors.executed, label: "executed: evidence seen" },
    ], "box"),
    el(
      "div",
      { class: "table-wrap" },
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, ["Renderer", "Tier", "Components", "Outcomes", "Blocked", "Inert", "Executed", "Cases"].map((h, i) => el("th", { class: i >= 4 ? "num" : undefined }, h)))),
        el("tbody", {}, rows),
      ),
    ),
    el("p", { class: "note" }, "¹ A data:, vbscript: or (through Lit) javascript: link handed to the application's link component unchecked. No contender checks a prop while drawing; this SDK checks URLs in the contract and again in every renderer. A design difference, published as such."),
    a.notExpressible.length ? el("p", { class: "note" }, `Not expressible: ${a.notExpressible.map((n) => `${nameOf(n.renderer)} ${n.id}`).join(", ")} (${a.notExpressible[0].why}).`) : null,
    a.withheld ? el("p", { class: "note" }, `${a.withheld.contenders} contender(s) withheld until ${a.withheld.until} under the disclosure policy.`) : null,
  );
}

function redteam() {
  const t = DATA.redteam;
  if (!t) return null;
  if (t.skipped) return card("Red-team", "Skipped: no local model was running.", "pnpm --filter relax-ui-bench bench:redteam");
  const prompts = [...new Set(t.summary.map((s) => s.prompt))];
  const cell = (s) => (s ? `${pct(s.attemptRate)}` : "—");
  const leak = (p) => {
    const rows = t.summary.filter((s) => s.prompt === p);
    const leaks = rows.reduce((n, s) => n + s.leakRate * s.runs, 0);
    return leaks ? el("td", { class: "num status-bad" }, `✕ ${leaks}`) : el("td", { class: "num" }, "0");
  };
  return card(
    "Red-team",
    `Twenty prompts aimed at the contract, sent as the topic of the Next example's route, ${t.runsPerPrompt} runs each per local model. Attempt: the raw model output held something forbidden. Leak: anything reached the page. ${t.total} runs: attempted in ${pct(t.attempts / t.total)}, leaked in ${t.leaks}.`,
    "pnpm --filter relax-ui-bench bench:redteam",
    el(
      "div",
      { class: "table-wrap" },
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, el("th", {}, "Prompt"), el("th", {}, "Aim"), t.models.map((m) => el("th", { class: "num" }, `Attempted, ${m}`)), el("th", { class: "num" }, "Leaks"))),
        el(
          "tbody",
          {},
          prompts.map((p) => {
            const aim = t.summary.find((s) => s.prompt === p)?.aim;
            return el("tr", {}, el("th", { scope: "row" }, p), el("td", {}, aim), t.models.map((m) => el("td", { class: "num" }, cell(t.summary.find((s) => s.prompt === p && s.model === m)))), leak(p));
          }),
        ),
      ),
    ),
  );
}

function versionsCard() {
  const v = DATA.versions;
  if (!v) return null;
  return card(
    "Versions",
    "The packages each renderer was measured with. \"workspace\" is this repository at the commit above.",
    null,
    el(
      "div",
      { class: "table-wrap" },
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, el("th", {}, "Renderer"), el("th", {}, "Packages"))),
        el(
          "tbody",
          {},
          Object.entries(v).map(([id, pkgs]) =>
            el("tr", {}, el("th", { scope: "row" }, nameOf(id)), el("td", {}, el("code", {}, Object.entries(pkgs).map(([n, ver]) => `${n}@${ver}`).join("  ")))),
          ),
        ),
      ),
    ),
  );
}

// --- Page ---------------------------------------------------------------------------

function lede() {
  const env = compareData?.environment;
  const parts = [];
  if (env) parts.push(`Measured on ${env.cpu}, ${env.memoryGb} GB, ${env.os}, ${env.browser}, at commit ${env.commit}.`);
  parts.push(`Built ${DATA.generated.slice(0, 10)} from ${[compareData?.file, DATA.soak?.file, DATA.attacks?.file, DATA.redteam?.file].filter(Boolean).join(", ")}.`);
  document.getElementById("lede").textContent = parts.join(" ");
}

const fixed = [];
function render() {
  const keepY = window.scrollY;
  for (const n of fixed.splice(0)) n.remove();
  const nodes = [summaryTiles(), filters(), breakPoints(), curves(), coldStart(), soak(), attacks(), redteam(), versionsCard()].filter(Boolean);
  for (const n of nodes) {
    app.append(n);
    fixed.push(n);
  }
  hideTip();
  window.scrollTo(0, keepY);
}

lede();
render();
