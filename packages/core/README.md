# relax-ui-core

Runtime-agnostic core of the [relaxAI Generative UI SDK](../../README.md):
schema-enforced structured generation, streaming partial objects, and a
sovereign-by-default transport.

**Zero runtime dependencies.** Zod is a peer. `fetch` is the only platform API
required, so the same build runs on Node ≥ 20, the Vercel Edge runtime,
Cloudflare Workers, Bun and Deno. No `node:` import appears anywhere in `src`,
and CI asserts it.

## Install

```bash
pnpm add relax-ui-core zod
```

## What is in here

| Area | Exports |
|---|---|
| Client | `RelaxClient`, `HttpClient` |
| Generation | `generateObject`, `streamObject`, `toSSEStream` |
| Schema | `defineStructuredSchema`, `toJsonSchema`, `safeParsePartial` |
| Capability | `CapabilityRegistry`, `negotiateStrategy`, `isCapabilityRejection` |
| Strategies | `nativeJsonSchemaStrategy`, `toolCallStrategy`, `promptedJsonStrategy` |
| Streaming | `parsePartialJson`, `diffJson`, `applyPatch`, `decodeSSE` |
| Generative UI | `createUIRegistry`, `urlString`, `displayText`, `measureTree` |
| Guards | `assertSovereignEndpoint`, `sanitizeUrl`, `redact` |
| Protocol | `UIStreamAccumulator`, `encodeUIStreamEvent` |
| Errors | `RelaxUIError`, `isRelaxUIError` |

## Minimal use

```ts
import { defineStructuredSchema, generateObject, RelaxClient } from "relax-ui-core";
import { z } from "zod";

const client = new RelaxClient();   // reads RELAX_API_KEY; validates the endpoint host

const Triage = defineStructuredSchema({
  name: "Triage",
  schema: z.object({ severity: z.enum(["low", "high"]), summary: z.string().max(280) }),
});

const { object, metadata } = await generateObject({
  client, model: "Llama-4-Maverick-17B-128E", schema: Triage, prompt: ticketText,
});
// object is typed and schema-valid, or the call threw a RelaxUIError.
// metadata.strategy tells you which of the three tiers actually ran.
```

Generative UI is the headline use case, not the only one: anything with a Zod
schema works.

→ [API reference](../../docs/api-reference.md) ·
[LLD](../../docs/lld.md) ·
[wire protocol](../../specs/001-generative-ui-sdk/contracts/ui-stream-protocol.md)
