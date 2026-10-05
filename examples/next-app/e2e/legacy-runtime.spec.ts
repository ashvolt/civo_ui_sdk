import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The capability ladder, in a browser, against an endpoint that refuses things.
 *
 * `dashboard.spec.ts` runs against a stand-in that honours constrained
 * decoding. This one refuses `response_format: json_schema` with a 400, the way
 * an older local runtime does, and can be told to answer a forced tool call
 * with nothing — both of which were observed against real endpoints.
 *
 * The tests are serial and order-dependent on purpose, because the thing being
 * tested is *memory*: the SDK learns from the first refusal and must not pay
 * for it twice. That is a property of a sequence of requests to one server
 * process, so it can only be asserted by a sequence of tests against one.
 *
 * It needs its own application instance for the same reason. What this app's
 * server learns here would otherwise leak into the other file's assertions.
 */

const STUB = "http://127.0.0.1:11438";

async function setMode(request: APIRequestContext, mode: "ok" | "emptytool"): Promise<void> {
  const response = await request.post(`${STUB}/__mode?mode=${mode}`);
  expect(response.ok(), `stub refused mode=${mode}`).toBe(true);
}

async function requestsSent(request: APIRequestContext): Promise<number> {
  const last = (await (await request.get(`${STUB}/__last`)).json()) as { requests: number };
  return last.requests;
}

async function generate(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Generate" })).toBeEnabled();
  await page.getByRole("button", { name: "Generate" }).click();
}

const footer = (page: Page) => page.locator("footer");
const alert = (page: Page) => page.locator('main [role="alert"]');

test.describe.configure({ mode: "serial" });

test.describe("an endpoint that refuses constrained decoding", () => {
  test("the first generation is refused, downgrades, and says so", async ({ page, request }) => {
    await setMode(request, "ok");
    await generate(page);

    await expect(page.getByRole("heading", { name: "UK public cloud spend" })).toBeVisible();
    await expect(footer(page)).toContainText("Structured via tool_call");
    await expect(footer(page)).toContainText("downgraded from native_json_schema");
    // One refused request, one answered.
    expect(await requestsSent(request)).toBe(2);
  });

  test("the second does not ask again for what was refused", async ({ page, request }) => {
    // FR-007, visible from the browser: the refusal was remembered, so this
    // generation starts on the tier that works and reports no downgrade.
    await setMode(request, "ok");
    await generate(page);

    await expect(footer(page)).toContainText("Structured via tool_call");
    await expect(footer(page)).not.toContainText("downgraded");
    expect(await requestsSent(request)).toBe(1);
  });

  test("the opening frame names the tier it fell back to", async ({ page, request }) => {
    await setMode(request, "ok");
    await page.goto("/?frames=1");
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(footer(page)).toContainText("Structured via tool_call");

    await expect(page.locator("[data-frame-type]").first()).toContainText("tool_call");
    await expect(page.locator('[data-frame-type="meta"]')).toHaveCount(1);
  });
});

test.describe("a forced tool call that returns nothing", () => {
  test("falls through to the next mechanism and still renders the document", async ({ page, request }) => {
    await setMode(request, "emptytool");
    await generate(page);

    await expect(page.getByText("Total spend")).toBeVisible();
    await expect(footer(page)).toContainText("Structured via prompted_json");
    await expect(footer(page)).toContainText("downgraded from tool_call");
    await expect(alert(page)).toHaveCount(0);
    // The empty tool call, then the prompted answer — and not a third request
    // re-asking the tier that had just said nothing.
    expect(await requestsSent(request)).toBe(2);
  });

  test("names the mechanism that produced the document, not the one that was tried", async ({ page, request }) => {
    await setMode(request, "emptytool");
    await page.goto("/?frames=1");
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(footer(page)).toContainText("Structured via prompted_json");

    const meta = page.locator('[data-frame-type="meta"]');
    await expect(meta).toHaveCount(1);
    await expect(meta).toContainText("prompted_json");
    await expect(meta).not.toContainText("tool_call");
  });

  test("is not remembered: the tool tier is tried again next time", async ({ page, request }) => {
    // An empty answer is a property of one response, not of the endpoint.
    await setMode(request, "ok");
    await generate(page);
    await expect(footer(page)).toContainText("Structured via tool_call");
    await expect(footer(page)).not.toContainText("downgraded");
  });
});
