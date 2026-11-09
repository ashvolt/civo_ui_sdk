# relax-ui-contract

The component vocabulary for the relaxAI Generative UI SDK: **twelve standard,
read-only components**, extensible by the application, and the one function both
the server and the browser derive their schemas from.

Depends on `relax-ui-protocol` (no dependencies of its own). Zod 3 is a peer.

## The twelve

| Component | Children | Props | Root role |
|---|---|---|---|
| Stack | required | `gap` (sm, md, lg), `direction` (column, row) | group |
| Grid | required | `columns` 1–4 | group |
| Card | optional | `title?`, `subtitle?` | region |
| Heading | — | `text`, `level` 1–4 | heading |
| Text | — | `text` (≤ 2,000), `tone` (default, muted) | paragraph |
| Metric | — | `label`, `value`, `trend?` (up, down, flat), `caption?` | group |
| List | — | `items` (1–20), `ordered` | list |
| Table | — | `caption?`, `columns` (1–8), `rows` (≤ 50 × 8) | table |
| Callout | — | `tone` (info, success, warning, danger), `title`, `body` | note |
| Badge | — | `text` (≤ 32), `tone` (neutral + the four) | note |
| Link | — | `label`, `href` (https, site-relative or mailto; URL guard) | link |
| Chart | — | `kind` (bar, line), `title`, `unit?`, `labels` (1–24), `series` (1–4 × 24 numbers) | img |

Every model-written string is bounded display text with no control characters.
No component can execute anything: there are no handler props, and `extend()`
refuses one. Props a component does not declare are dropped, never passed on.

## Use

```ts
import { createUIRegistry } from "relax-ui-core";
import { displayText, standardContract, urlString } from "relax-ui-contract";
import { z } from "zod";

// Add a component, or narrow a standard one. Never remove one.
export const contract = standardContract.extend(
  {
    Link: {
      ...standardContract.specs.Link,
      props: z.object({ label: displayText(80), href: urlString({ allowedHosts: ["bank.example"] }) }),
    },
  },
  { maxNodes: 80, maxDepth: 6 },
);

// Server: the JSON Schema the model is decoded against.
export const schema = createUIRegistry(contract.specs, contract.limits).structuredSchema("Dashboard");

// Browser: validate a document from anywhere.
contract.documentSchema.safeParse(document);
```

Both sides call the same `buildUISchemas` over the same declaration, so the
schema the model is held to and the schema the browser checks cannot drift
(FR-211). A test asserts their JSON Schemas are equal.

## Rules `defineContract` and `extend` enforce

- Names match `^[A-Z][A-Za-z0-9]{0,31}$`.
- Every component states the ARIA role its root takes.
- No prop is a function, and no prop key names a handler (`onClick`, `action`, …),
  at any depth.
- `extend()` may add or override; passing `undefined` for an existing name is
  refused. The contract it extends is unchanged.

Size: 2.9 KB gzip for the package; 17 KB with Zod, which is what full browser
validation costs (`pnpm size`).
