import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * T-255: `<gen-ui>` in an Angular application (AOT), with Angular Material
 * through `relax-ui-connect-angular`, served under `script-src 'self'` and
 * nonce-only inline styles.
 */

async function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
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

test("both elements render under a strict policy, with no violation and no error", async ({ page }) => {
  const seen = await watch(page);
  const response = await page.goto("/");
  const policy = response!.headers()["content-security-policy"]!;
  expect(policy).toContain("script-src 'self'");
  expect(policy).not.toMatch(/unsafe-eval|unsafe-inline/);
  expect(policy).toMatch(/style-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
  await rendered(page, "base");
  await rendered(page, "material");
  expect(await seen.csp()).toEqual([]);
  expect(seen.errors).toEqual([]);
  await expect(page.locator('output[for="base"]')).toContainText("complete · provider local");
  await expect(page.locator('output[for="material"]')).toContainText("base theme for");
  await page.screenshot({ path: test.info().outputPath("angular.png"), fullPage: true });
});

test("the app ships compiled templates: no Angular compiler on the page", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (r) => {
    if (r.url().endsWith(".js")) bodies.push(await r.text().catch(() => ""));
  });
  await page.goto("/");
  await rendered(page, "material");
  // The JIT compiler's entry point; present only if templates compile in the browser.
  expect(bodies.some((b) => b.includes("ɵcompileComponent"))).toBe(false);
});

test("Angular Material draws its own components, with the renderer's children projected", async ({ page }) => {
  await page.goto("/");
  await rendered(page, "material");
  const mat = page.locator("gen-ui#material");
  const card = mat.locator('mat-card[role="region"]');
  await expect(card.locator("mat-card-title")).toHaveText("By region · Angular Material");
  // The table is Material's mat-table; the badges are mat-chips, both drawn
  // by the renderer into the card's <ng-content>.
  await expect(card.locator("mat-card-content table[mat-table] tr[mat-row]")).toHaveCount(2);
  await expect(card.locator('mat-chip[role="note"]')).toHaveCount(2);
  await expect(mat.locator('mat-card[role="group"]')).toHaveCount(3);
  // Material's theme applies: a card has its outline.
  expect(await card.evaluate((c) => getComputedStyle(c).borderTopStyle)).toBe("solid");
});

test("an Angular change detection pass leaves the element's document alone", async ({ page }) => {
  await page.goto("/");
  await rendered(page, "base");
  await rendered(page, "material");
  const heading = await page.evaluateHandle(() => document.getElementById("base")!.shadowRoot!.querySelector(".gen-heading")!);
  const card = await page.evaluateHandle(() => document.querySelector("#material mat-card")!);
  await page.selectOption("#variant", "dark");
  await expect(page.locator("gen-ui#base")).toHaveAttribute("variant", "dark");
  expect(await heading.evaluate((h) => h.isConnected)).toBe(true);
  expect(await card.evaluate((c) => c.isConnected)).toBe(true);
  expect(
    await page.evaluate(() => getComputedStyle(document.getElementById("base")!.shadowRoot!.querySelector(".gen-theme")!).backgroundColor),
  ).toBe("rgb(21, 22, 27)");
});

test("axe: both elements pass", async ({ page }) => {
  await page.goto("/");
  await rendered(page, "base");
  await rendered(page, "material");
  const result = await new AxeBuilder({ page }).include("#base").include("#material").analyze();
  expect(result.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});
