# Quickstart

From nothing to a streaming, schema-validated, model-designed dashboard.

This file doubles as the acceptance test for one of the spec's success criteria:
**under 30 lines of application code**. The three files below total 27.

---

## 0. Install

```bash
pnpm add relax-ui-core relax-ui-react relax-ui-next zod
```

```bash
# .env.local — server-side only. No NEXT_PUBLIC_ prefix, ever.
RELAX_API_KEY=your-relaxai-key
```

A key in a `NEXT_PUBLIC_` variable is shipped to every browser that loads the
page. The SDK cannot stop you doing that, so it is worth saying once: don't.

---

## 1. Declare the vocabulary — `app/ui-registry.ts`

This is the only place components are declared. It feeds the JSON Schema sent to
relaxAI, the server-side validator, and the client renderer's lookup table.

```ts
import { createUIRegistry, displayText, urlString } from "relax-ui-core";
import { z } from "zod";

export const registry = createUIRegistry({
  Stack:  { props: z.object({ heading: displayText(120).optional() }), children: "required" },
  Metric: { props: z.object({ label: displayText(60), value: displayText(24) }),
            description: "A headline number. `value` is pre-formatted, e.g. '£1.2m'." },
  Note:   { props: z.object({ text: displayText(400) }) },
  Source: { props: z.object({ label: displayText(80), href: urlString({ schemes: ["https:"] }) }) },
});

export const schema = registry.structuredSchema("Dashboard");
```

Adding a component here makes it available to the model. Removing it makes the
model **structurally incapable** of emitting it — the generated type union has no
branch for it, so a document naming it fails validation. There is no second place
to check and no allowlist to keep in sync.

`description` is worth writing properly. It is the single biggest lever on output
quality, because it is what the model actually reads.

---

## 2. Expose the route — `app/api/ui/route.ts`

```ts
import { RelaxClient } from "relax-ui-core";
import { createGenerativeUIRoute } from "relax-ui-next";
import { z } from "zod";
import { schema } from "../../ui-registry";

export const runtime = "edge";

const client = new RelaxClient();  // reads RELAX_API_KEY; validates the endpoint host

export const POST = createGenerativeUIRoute({
  client,
  model: "Llama-4-Maverick-17B-128E",
  schema,
  inputSchema: z.object({ topic: z.string().min(3).max(300) }),
  system: "You design compact analytics dashboards. Use a Stack root.",
  toMessages: (input) => [{ role: "user", content: `Build a dashboard about: ${input.topic}` }],
  frameIntervalMs: 50,
});
```

Note what the browser **cannot** send: `model`, `schema`, `system`, `sampling`.
They are fixed here. A route that lets the client pick the model is a bill; one
that lets it supply the system prompt is a jailbreak with a REST interface.

`inputSchema` is the boundary. Anything that fails it is a 400, not a prompt.

---

## 3. Render it — `app/page.tsx`

```tsx
"use client";
import type { UINode } from "relax-ui-core";
import { createGenerativeRenderer, useGenerativeObject } from "relax-ui-react";
import { registry } from "./ui-registry";

const Dashboard = createGenerativeRenderer(registry, {
  Stack:  ({ props, children }) => <section><h2>{props.heading}</h2>{children}</section>,
  Metric: ({ props }) => <div><small>{props.label}</small><strong>{props.value}</strong></div>,
  Note:   ({ props }) => <p>{props.text}</p>,
  Source: ({ props }) => <a href={props.href} rel="noopener noreferrer">{props.label}</a>,
} as never);

export default function Page() {
  const { object, isStreaming, error, submit } = useGenerativeObject<{ root: UINode }>({ api: "/api/ui" });
  return (
    <main>
      <button onClick={() => submit({ topic: "UK public cloud spend" })} disabled={isStreaming}>
        {isStreaming ? "Generating…" : "Generate"}
      </button>
      {error ? <p role="alert">{error.code}: {error.message}</p> : null}
      <Dashboard node={object?.root} />
    </main>
  );
}
```

`object` is partial for most of the stream — children arrive one at a time, props
fill in mid-word — and the renderer handles that, because the schema's
required/optional rules are only enforced at completion.

---

## What just happened

1. The hook POSTs `{ topic }` to `/api/ui`.
2. The route validates the body, builds the conversation, and asks relaxAI for a
   `Dashboard`.
3. The SDK negotiates a structuring strategy. On Maverick, constrained decoding
   is not available, so it uses **tool calling** — and remembers, so the next
   request skips the dead tier.
4. As tokens arrive: reasoning and fences are stripped, the partial document is
   repaired and parsed, and the result is validated under streaming rules.
5. Each change is diffed and sent as a JSON Patch frame.
6. The browser applies patches with structural sharing, so untouched branches
   keep referential equality and don't re-render.
7. At the end, the full schema runs. If it fails, the SDK repairs off-stream and
   replaces the document. The `complete` frame means *this passed the schema*.

---

## Batch instead of streaming

```ts
import { generateObject, RelaxClient } from "relax-ui-core";

const { object, metadata } = await generateObject({
  client: new RelaxClient(),
  model: "DeepSeek-V31-Terminus",
  schema,
  prompt: "Build a dashboard about Q3 churn",
});

console.log(metadata.strategy, metadata.downgradedFrom, metadata.repairAttempts);
```

`object` is typed and validated, or the call threw a `RelaxUIError`.

---

## Any schema, not just UI

Generative UI is the headline use case, not the only one.

```ts
import { defineStructuredSchema, generateObject } from "relax-ui-core";
import { z } from "zod";

const Triage = defineStructuredSchema({
  name: "Triage",
  schema: z.object({
    severity: z.enum(["low", "medium", "high", "critical"]),
    team: z.string(),
    summary: z.string().max(280),
  }),
});

const { object } = await generateObject({ client, model, schema: Triage, prompt: ticketText });
```

---

## Operating it

### Which strategy ran?

```ts
onEvent: (event) => {
  if (event.type === "strategy_downgraded") console.info(event.from, "→", event.to, event.reason);
  if (event.type === "repair_attempt")     console.warn("repair", event.attempt, event.issues);
}
```

A rising repair rate means the schema or the prompt needs work, not that the
model is broken.

### Counters without a transport

```ts
import { MetricsCollector } from "relax-ui-core";
const metrics = new MetricsCollector();
// pass metrics.handler as onEvent; read metrics.snapshot() from your own /metrics
```

The SDK never sends these anywhere. Exporting them is your call.

### Lock the endpoint down further

```ts
new RelaxClient({
  sovereignty: { allowedHosts: ["api.relax.ai"] },  // the default, made explicit
  redaction: true,
  onRedaction: (hits) => logger.warn({ hits }, "redacted outbound prompt"),
});
```

### Force or forbid a tier

```ts
allowStrategies: ["native_json_schema", "tool_call"],  // never fall back to prompting
forceStrategy: "tool_call",                            // skip negotiation entirely
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `config_invalid: Missing relaxAI API key` | env var not loaded | `RELAX_API_KEY` in `.env.local`; restart dev server |
| `sovereignty_violation` | `baseURL` host not allowlisted | correct it, or add the host to `sovereignty.allowedHosts` |
| `capability_unsupported` | model is embeddings-only | use a chat model |
| `schema_violation` after repair | schema too strict, or descriptions too thin | add `.describe()` to fields; loosen constraints the model cannot know |
| Stream arrives all at once | a proxy is buffering | confirm `X-Accel-Buffering: no` survives your CDN |
| `RangeError` / stack overflow | none expected — budget checks are iterative | file a bug |
| Nodes silently missing | failing the registry's prop schema | pass `onInvalidNode` to see why |
