# relax-ui-next

Next.js App Router adapter for the [relaxAI Generative UI SDK](../../README.md):
one-line streaming route handlers with server-side schema enforcement.

**Imports nothing from `next`.** The handlers are `(Request) => Promise<Response>`,
which is what the App Router wants and what the Edge runtime, Cloudflare Workers
and a plain `fetch` test all accept unchanged.

## Install

```bash
pnpm add relax-ui-next relax-ui-core zod
```

## Use

```ts
// app/api/ui/route.ts
import { RelaxClient } from "relax-ui-core";
import { createGenerativeUIRoute } from "relax-ui-next";
import { z } from "zod";
import { dashboardSchema } from "../../ui-registry";

export const runtime = "edge";

const client = new RelaxClient();   // module scope: the key is read once, at cold start

export const POST = createGenerativeUIRoute({
  client,
  model: "Llama-4-Maverick-17B-128E",
  schema: dashboardSchema,
  inputSchema: z.object({ topic: z.string().min(3).max(300) }),
  system: "You design compact analytics dashboards.",
  toMessages: (input) => [{ role: "user", content: `Dashboard about: ${input.topic}` }],
  authorize: async (req) => (await getSession(req)) ? undefined : new Response("Unauthorized", { status: 401 }),
  frameIntervalMs: 50,
});
```

## The interesting part is what the browser cannot send

`model`, `schema`, `system` and `sampling` are fixed at construction. A route that
lets the client pick the model is a bill; a route that lets it supply the schema or
the system prompt is a jailbreak with a REST interface. The type signature makes
the alternative unexpressible, and there is a test asserting that a body containing
`model` or `system` cannot influence either.

`inputSchema` is the boundary: anything failing it is a 400 that costs zero tokens,
and the response echoes the failing **paths** only — the values may be personal
data.

## Also

- `createGenerativeObjectRoute` — the same config, returning the finished object as
  JSON for a server component or action.
- `request.signal` propagates to relaxAI, so a closed tab cancels the generation.
- `X-Accel-Buffering: no` is set because Nginx and several CDNs buffer unknown
  content types by default, silently turning a streaming route into a slow
  non-streaming one.
- Failures after the stream opens arrive **in band** as an `error` frame on a 200 —
  by then the status line is long gone.

→ [API reference](../../docs/api-reference.md) ·
[wire protocol](../../specs/001-generative-ui-sdk/contracts/ui-stream-protocol.md)
