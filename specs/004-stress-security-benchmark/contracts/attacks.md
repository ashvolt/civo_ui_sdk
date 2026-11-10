# Contract — Attack catalogue

Each family lists its techniques and the safe outcome required of this SDK.
Payloads are this repository's own (research R7). Each payload calls
`window.__relaxPwned(id)` if it ever runs.

## Injection (FR-430)

Placement: every text and URL prop of every component, every connector (base,
Bootstrap, Shoelace, MUI, Element Plus, Angular Material), both tiers, every
host. Required outcome: **blocked** (refused at validation) or **inert**
(rendered as text).

| Technique | Examples of shape |
|---|---|
| Event handlers | `<img src=x onerror=…>`, `<svg onload=…>`, `<details open ontoggle=…>`, on every HTML and SVG tag |
| Script URLs | `javascript:`, `JaVaScRiPt:`, `java\tscript:`, `&#106;avascript:`, `%6Aavascript:`, `javascript:`, null bytes, leading control characters, `data:text/html`, `vbscript:` |
| Breakouts | `</title>`, `</textarea>`, `</style>`, `-->`, `]]>` followed by markup |
| Namespace confusion | SVG and MathML wrappers around HTML, `<svg><style>` |
| Mutation XSS | `<noscript>`, `<template>`, nested forms, attribute-value breaking |
| Template expressions | `{{constructor.constructor('…')()}}`, `${…}`, Vue `{{ }}`, Angular `{{ }}` |
| CSS | `url(javascript:…)`, `expression(…)`, `@import` |
| Display spoofing | right-to-left override, zero-width joiners in link labels |
| Fuzz | seeded mutations of every case above: case, encodings, whitespace, control characters, nesting |

## Protocol and denial of service (FR-431)

| Case | Required outcome |
|---|---|
| Out-of-order, duplicate, missing sequence | refused with a stable code; nothing half-applied |
| Truncated stream; socket closed mid-document | `truncated` |
| Malformed JSON; invalid SSE framing; binary garbage | ignored or refused; page responsive |
| Oversized frame (1, 10, 100 MB) | refused or bounded within the memory budget |
| Slow-drip stream | page responsive; `stop()` ends it |
| Over-budget document (nodes, depth) | refused before rendering |
| 10,000 sibling key collisions | bounded time |
| WebSocket flood | bounded memory |

## Injection tricks (FR-432)

| Case | Required outcome |
|---|---|
| `__proto__`, `constructor`, `prototype` keys in props and patch paths | no global or renderer object modified |
| Values shaped as CSS or selectors | no request leaves the page |
| Attempts to set `style`, `class`, `slot`, `part`, `id` through props | not applied beyond what the template sets |
| Overlay and full-viewport attempts | nothing generated renders outside its element's box |
| Policy bypass (base, meta refresh, form action, import maps) | not rendered |

## Red-team (FR-433)

About twenty prompts × five runs × two local models. Two numbers per prompt:
the **attempt rate** (raw model output with something forbidden, before
validation) and the **leak rate** (forbidden output on the page). The leak rate
MUST be zero.

## Classification (FR-434)

| Evidence | Outcome |
|---|---|
| Canary called, or a forbidden element, attribute or URL found, or a request left the page, or a global changed, or bounds escaped | **executed** |
| None of the above, and the renderer reported a refusal | **blocked** |
| None of the above, and the payload was drawn as text | **inert** |
