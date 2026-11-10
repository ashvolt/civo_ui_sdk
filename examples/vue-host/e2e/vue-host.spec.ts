import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * T-255: `<gen-ui>` in a Vue application, with Element Plus through
 * `relax-ui-connect-vue`, served under `script-src 'self'; style-src 'self'`.
 */

async function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" || (m.type() === "warning" && m.text().includes("[Vue warn]"))) errors.push(m.text());
  });
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return { errors, csp: () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp) };
}

async function rendered(page: Page, id: string) {
  await expect(page.locator(`gen-ui#${id}`)).toHaveAttribute("data-status", "complete");
  await expect
    .poll(() => page.evaluate((i) => (document.getElementById(i)!.shadowRoot ?? document.getElementById(i)!).querySelectorAll("[aria-busy]").length, id))
    .toBe(0);
}

test("both elements render under a strict policy, with no violation, error or Vue warning", async ({ page }) => {
  const seen = await watch(page);
  const response = await page.goto("/");
  expect(response!.headers()["content-security-policy"]).toContain("script-src 'self'");
  expect(response!.headers()["content-security-policy"]).not.toMatch(/unsafe-eval|unsafe-inline/);
  await rendered(page, "base");
  await rendered(page, "element-plus");
  expect(await seen.csp()).toEqual([]);
  expect(seen.errors).toEqual([]);
  await expect(page.locator('output[for="base"]')).toContainText("complete · provider local");
  await expect(page.locator('output[for="element-plus"]')).toContainText("base theme for");
  await page.screenshot({ path: test.info().outputPath("vue.png"), fullPage: true });
});

test("Element Plus draws its own components, styled by its stylesheet, around the renderer's children", async ({ page }) => {
  await page.goto("/");
  await rendered(page, "element-plus");
  const ep = page.locator("gen-ui#element-plus");
  const card = ep.locator('.el-card[role="region"]');
  await expect(card.locator(".el-card__header")).toContainText("By region · Element Plus");
  // The table is the base theme's (a fallback), drawn by the renderer inside
  // Element Plus's card body.
  await expect(card.locator(".el-card__body table.gen-table tbody tr")).toHaveCount(2);
  await expect(ep.locator('.el-alert[role="note"]')).toHaveClass(/el-alert--warning/);
  await expect(ep.locator('.el-tag[role="note"]')).toHaveCount(2);
  // Element Plus's stylesheet applies: a card has its border radius.
  expect(await card.evaluate((c) => getComputedStyle(c).borderTopLeftRadius)).not.toBe("0px");
});

test("Vue re-renders the page without disturbing the element's document", async ({ page }) => {
  await page.goto("/");
  await rendered(page, "base");
  await rendered(page, "element-plus");
  const heading = await page.evaluateHandle(() => document.getElementById("base")!.shadowRoot!.querySelector(".gen-heading")!);
  const card = await page.evaluateHandle(() => document.querySelector("#element-plus .el-card")!);
  // A Vue state change (the variant select) re-renders the app's tree; the
  // elements keep their content and only restyle.
  await page.selectOption("#variant", "dark");
  await expect(page.locator("gen-ui#base")).toHaveAttribute("variant", "dark");
  expect(await heading.evaluate((h) => h.isConnected)).toBe(true);
  expect(await card.evaluate((c) => c.isConnected)).toBe(true);
  expect(
    await page.evaluate(() => getComputedStyle(document.getElementById("base")!.shadowRoot!.querySelector(".gen-theme")!).backgroundColor),
  ).toBe("rgb(21, 22, 27)");
});

test("axe: the base-theme element passes in light and dark; Element Plus in light", async ({ page }) => {
  await page.goto("/");
  await rendered(page, "base");
  await rendered(page, "element-plus");
  const report = (violations: { id: string; nodes: { target: unknown[] }[] }[]) =>
    violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(report((await new AxeBuilder({ page }).include("#base").include("#element-plus").analyze()).violations)).toEqual([]);
  await page.selectOption("#variant", "dark");
  await expect(page.locator("gen-ui#base")).toHaveAttribute("variant", "dark");
  expect(report((await new AxeBuilder({ page }).include("#base").analyze()).violations)).toEqual([]);
});
