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
 */

const STUB = "http://127.0.0.1:11437";

/** Chooses which awkwardness the stand-in endpoint exhibits for this test. */
async function setMode(request: APIRequestContext, mode: "ok" | "truncate" | "badtype"): Promise<void> {
  const response = await request.post(`${STUB}/__mode?mode=${mode}`);
  expect(response.ok(), `stub refused mode=${mode}`).toBe(true);
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

  test("shows the tier it negotiated, after the endpoint refused the better one", async ({ page }) => {
    // The stand-in rejects `response_format: json_schema` the way Ollama does.
    // Landing on `tool_call` is the ladder working, visible from the browser.
    await generate(page);
    await expect(footer(page)).toContainText("tool_call");
    await expect(footer(page)).toContainText("qwen2.5:7b");
    await expect(footer(page)).not.toContainText("native_json_schema");
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
