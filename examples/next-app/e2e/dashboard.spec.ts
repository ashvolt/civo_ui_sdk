import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The wiring, in a browser.
 *
 * Each layer of this SDK is unit-tested in isolation, which is where the hard
 * logic lives — but isolation is exactly what those tests cannot check. This
 * file asserts the joins: that the route's SSE frames reach the hook, that the
 * hook's JSON patches reach the renderer, that a document still being written
 * paints rather than throwing, and that a failed generation says what failed
 * instead of leaving a page that looks finished.
 *
 * The endpoint is a local stand-in, so every assertion here is about the SDK.
 * Asserting on a real model's output would make this a test of the model.
 *
 * This file runs against a stand-in that honours constrained decoding, which is
 * what a current local runtime does. `legacy-runtime.spec.ts` runs the same app
 * against one that refuses it.
 */

const STUB = "http://127.0.0.1:11437";

type Mode = "ok" | "truncate" | "badtype" | "emptytool";

/** Chooses which awkwardness the stand-in endpoint exhibits for this test. */
async function setMode(request: APIRequestContext, mode: Mode): Promise<void> {
  const response = await request.post(`${STUB}/__mode?mode=${mode}`);
  expect(response.ok(), `stub refused mode=${mode}`).toBe(true);
}

/** Facts about the last request the application server sent upstream. */
async function lastRequest(request: APIRequestContext): Promise<{
  tier: string;
  schemaHadPattern: boolean;
  hadAuthorization: boolean;
  requests: number;
}> {
  return (await request.get(`${STUB}/__last`)).json();
}

async function generate(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Generate" })).toBeEnabled();
  await page.getByRole("button", { name: "Generate" }).click();
}

const footer = (page: Page) => page.locator("footer");

/**
 * The app's own error alert.
 *
 * Scoped to `main` deliberately: Next renders a route announcer with
 * `role="alert"` outside it, so an unscoped `getByRole("alert")` matches two
 * elements and every assertion becomes a strict-mode violation.
 */
const alert = (page: Page) => page.locator('main [role="alert"]');

test.describe("a successful generation", () => {
  test.beforeEach(async ({ request }) => setMode(request, "ok"));

  test("streams a validated document into the page", async ({ page }) => {
    await generate(page);

    // The heading comes from the model's document, not from the app: seeing it
    // means a `Stack` node's props survived the whole pipeline.
    await expect(page.getByRole("heading", { name: "UK public cloud spend" })).toBeVisible();
    await expect(page.getByText("Total spend")).toBeVisible();
    await expect(page.getByText("£4.1bn")).toBeVisible();
    await expect(page.getByText("18%")).toBeVisible();

    // And the terminal frame arrived, so this is a validated document rather
    // than a half-written one that happens to look right.
    await expect(footer(page)).toContainText("Structured via");
    await expect(alert(page)).toHaveCount(0);
  });

  test("shows the tier it negotiated, and the model and provider that answered", async ({ page }) => {
    // This endpoint honours constrained decoding, as Ollama 0.5+ does, so the
    // ladder stops at its first rung. The refusal path — and the downgrade it
    // causes — is `legacy-runtime.spec.ts`, against an endpoint that refuses.
    await generate(page);
    await expect(footer(page)).toContainText("Structured via native_json_schema");
    await expect(footer(page)).toContainText("qwen2.5:7b");
    await expect(footer(page)).toContainText("(ollama)");
    await expect(footer(page)).not.toContainText("downgraded");
  });

  test("renders model text as text", async ({ page }) => {
    await generate(page);
    // The Prose node's text reaches the DOM as a text node. If it were ever
    // interpolated as markup, this passes and the security tests catch it — so
    // what this really pins is that the node rendered at all.
    await expect(page.getByText("Figures illustrative", { exact: false })).toBeVisible();
  });
});

test.describe("a generation that runs out of tokens", () => {
  test.beforeEach(async ({ request }) => setMode(request, "truncate"));

  test("says the budget ran out rather than blaming the schema", async ({ page }) => {
    await generate(page);

    await expect(alert(page)).toContainText("truncated");
    await expect(alert(page)).toContainText("max_tokens");
    // The distinction that matters: not reported as the schema's fault.
    await expect(alert(page)).not.toContainText("schema_violation");
  });

  test("does not leave a footer that reads as success", async ({ page }) => {
    // This regressed once: `strategy` arrives with the opening frame and
    // `metadata` only with the terminal one, so rendering the first alone made
    // a failed generation look finished.
    await generate(page);
    await expect(footer(page)).toContainText("Failed after negotiating");
    await expect(footer(page)).not.toContainText("Structured via");
  });
});

test.describe("a generation that violates the schema", () => {
  test.beforeEach(async ({ request }) => setMode(request, "badtype"));

  test("names the field that broke", async ({ page }) => {
    await generate(page);

    await expect(alert(page)).toContainText("schema_violation");
    // The redacted issue list, all the way from the server's validator to the
    // browser: the path is present, the offending value is not.
    await expect(alert(page)).toContainText("root.children.0.props.value");
    await expect(alert(page)).toContainText("invalid_type");
    await expect(alert(page)).not.toContainText("4100000000");
  });

  test("renders nothing from the rejected document", async ({ page }) => {
    await generate(page);
    await expect(alert(page)).toBeVisible();
    // A `Metric` whose `value` is a number never reaches the renderer: the
    // server aborts on the offending token, so no partial card is painted.
    await expect(page.getByText("Total spend")).toHaveCount(0);
  });
});

test.describe("a local provider", () => {
  test.beforeEach(async ({ request }) => setMode(request, "ok"));

  test("says which endpoint is serving, and that it is not a sovereign one", async ({ page }) => {
    await page.goto("/");
    const banner = page.getByTestId("provider-banner");
    await expect(banner).toContainText("Local model");
    await expect(banner).toContainText("Ollama (127.0.0.1:11437)");
    await expect(banner).toContainText("Not a sovereign endpoint");
    await expect(banner).toContainText("loopback-only allowlist");
  });

  test("uses the constrained tier when the runtime honours it", async ({ page, request }) => {
    await generate(page);
    await expect(footer(page)).toContainText("Structured via native_json_schema");
    await expect(footer(page)).toContainText("(ollama)");
    await expect(footer(page)).not.toContainText("downgraded");
    expect((await lastRequest(request)).tier).toBe("native_json_schema");
  });

  test("sends that tier a schema the runtime can actually enforce", async ({ page, request }) => {
    // Measured against Ollama 0.35: a schema carrying `pattern` is accepted and
    // then not enforced at all. The profile's dialect keeps it off the wire —
    // while the application's own schema, which has it, still validates.
    await generate(page);
    await expect(footer(page)).toContainText("Structured via");
    const last = await lastRequest(request);
    expect(last.schemaHadPattern).toBe(false);
    // And a keyless provider sends no placeholder credential.
    expect(last.hadAuthorization).toBe(false);
  });
});

test.describe("the frame inspector", () => {
  test.beforeEach(async ({ request }) => setMode(request, "ok"));

  test("is closed by default and opens on request", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("frame-inspector")).toHaveCount(0);
    await page.getByLabel("Show frames").check();
    await expect(page.getByTestId("frame-inspector")).toBeVisible();
    await expect(page.getByTestId("frame-stats")).toContainText("Nothing sent yet");
  });

  test("lists the stream: meta first, document frames, then complete", async ({ page }) => {
    await page.goto("/?frames=1");
    await expect(page.getByTestId("frame-inspector")).toBeVisible();
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(footer(page)).toContainText("Structured via");

    const rows = page.locator("[data-frame-type]");
    await expect(rows.first()).toHaveAttribute("data-frame-type", "meta");
    await expect(rows.first()).toContainText("native_json_schema");
    await expect(rows.first()).toContainText("ollama");
    await expect(rows.last()).toHaveAttribute("data-frame-type", "complete");

    // More than one document frame: it arrived as a stream. Not many more,
    // here — the stand-in answers instantly and the route coalesces frames
    // under an 80ms throttle — but against a real model this is hundreds.
    const documentFrames = await page.locator('[data-frame-type="patch"], [data-frame-type="snapshot"]').count();
    expect(documentFrames).toBeGreaterThan(1);
    await expect(page.locator('[data-frame-type="meta"]')).toHaveCount(1);
    await expect(page.locator('[data-frame-type="complete"]')).toHaveCount(1);
    expect(Number(await page.getByTestId("frame-count").textContent())).toBe(await rows.count());
  });

  test("ends on the error frame when the generation fails", async ({ page, request }) => {
    await setMode(request, "badtype");
    await page.goto("/?frames=1");
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(alert(page)).toContainText("schema_violation");

    const rows = page.locator("[data-frame-type]");
    await expect(rows.last()).toHaveAttribute("data-frame-type", "error");
    await expect(rows.last()).toContainText("schema_violation");
    await expect(page.locator('[data-frame-type="complete"]')).toHaveCount(0);
  });

  test("starts again from empty on the next generation", async ({ page }) => {
    await page.goto("/?frames=1");
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(footer(page)).toContainText("Structured via");
    const first = await page.locator("[data-frame-type]").count();

    await page.getByRole("button", { name: "Generate" }).click();
    await expect(footer(page)).toContainText("Structured via");
    await expect(page.locator('[data-frame-type="meta"]')).toHaveCount(1);
    expect(await page.locator("[data-frame-type]").count()).toBe(first);
  });
});
