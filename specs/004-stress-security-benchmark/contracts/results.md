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
  };
  renderers: { id: string; packages: Record<string, string>; available: boolean; reason?: string }[];
  workloads: { id: string; dimension: string; seed: number; steps: number[]; contract: "standard" | "bench" }[];
  ladders: {
    renderer: string; profile: "desktop" | "phone"; workload: string;
    expressible: boolean; reason?: string;
    steps: { size: number; metrics: Record<string, { median: number; iqr: number }>; samples: unknown; broken?: string }[];
    breakPoint: number | "below-first-step" | "not-reached";
    brokenBy?: string;
  }[];
  soak?: {
    renderer: string; minutes: number;
    series: { minute: number; heap: number; domNodes: number; listeners: number; mounted?: number }[];
    detachedStart: number; detachedEnd: number; passed: boolean;
  }[];
  attacks: {
    caseId: string; family: string; technique: string;
    renderer: string; host?: string; connector?: string; tier?: "full" | "server";
    outcome: "blocked" | "inert" | "executed";
    evidence: Record<string, unknown>; errorCode?: string;
  }[];
  redteam?: { model: string; prompt: string; runs: number; attempts: number; leaks: number }[];
}
```

**Rules**

- Embargoed outcomes (a contender's `executed`) are not written here (FR-435).
- Raw `samples` may be gzipped beside the file if large; the file names it.
- A change to this shape bumps `schemaVersion`. The dashboard reads every
  version it knows.
