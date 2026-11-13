# Contract — Result file

One JSON file per suite run, under `bench/results/`. Schema version 1.

```ts
interface ResultFile {
  schemaVersion: 1;
  budgetVersion: number;               // contracts/budgets.md
  suite: "smoke" | "nightly" | "local";
  environment: {
    machine: string;                   // a name, e.g. "bench-laptop-1"; CI runners say "github-ubuntu-latest"
    cpu: string; cores: number; memoryGb: number; os: string;
    browser: string;                   // e.g. "Chromium 141.0.…"
    node: string; commit: string; date: string;
    calibrationMs?: number;            // smoke runs: a fixed CPU job's time, reported beside the regression check
  };
  renderers: { id: string; packages: Record<string, string>; available: boolean; reason?: string }[];
  workloads: { id: string; dimension: string; seed: number; steps: number[]; contract: "standard" | "bench" }[];
  ladders: {
    renderer: string; profile: "desktop" | "phone"; workload: string;
    expressible: boolean; reason?: string;
    steps: { size: number; metrics: Record<string, { median: number; iqr: number }>; samples: unknown; broken?: string }[];
    breakPoint: number | "below-first-step" | "not-reached" | "not-expressible";
    brokenBy?: string;
  }[];
  // A twelve-component document in a fresh page: what a user pays once.
  coldStart?: { renderer: string; profile: "desktop" | "phone"; metrics: Record<string, { median: number; iqr: number }>; broken?: string }[];
  soak?: {
    renderer: string; minutes: number;
    series: { minute: number; heap: number; domNodes: number; listeners: number; mounted?: number; expectedMounted?: number }[];
    detachedStart: number; detachedEnd: number; passed: boolean;
  }[];
  attacks: {
    caseId: string; family: string; technique: string;
    renderer: string; host?: string; connector?: string; tier?: "full" | "server" | "own";
    outcome: "blocked" | "inert" | "executed";
    evidence: Record<string, unknown>; errorCode?: string;
    /** A contender's `executed` that is published: "passed-through-unchecked". */
    cause?: string;
  }[];
  /** Cases a contender's wire format cannot carry (`own` tier only). */
  notExpressible?: { renderer: string; id: string; why: string }[];
  /** Present when the disclosure gate held contenders back; no names. */
  withheld?: { contenders: number; until: string; why: string };
  redteam?: { model: string; prompt: string; runs: number; attempts: number; leaks: number }[];
}
```

**Rules**

- Embargoed outcomes (a contender's `executed`) are not written here (FR-435).
  Nor is any other result of that contender: they go to
  `bench/results/private/` (untracked), and `withheld` counts them.
- Raw `samples` may be gzipped beside the file if large; the file names it.
- Nightly results, from shared runners, go to `bench/results/nightly/`, merged
  from the parallel jobs with raw `samples` dropped; the headline results in
  `bench/results/` come from one named machine.
- Step metrics include `busy`: main-thread task time while the step streamed,
  in ms (Chromium's `TaskDuration`), the pull-request regression check's metric.
- Adding an optional field (`calibrationMs`, 2026-11-14) keeps the version;
  any other change to this shape bumps `schemaVersion`. The dashboard reads every
  version it knows.
