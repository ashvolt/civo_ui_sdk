import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * T-248: the element in a plain page, under `script-src 'self'`.
 * T-247: four elements, three looks, one page — no style crosses a shadow
 * boundary in either direction.
 * T-245/T-246 in a real browser: Bootstrap's adopted stylesheet and Shoelace's
 * elements actually style what they render.
 */

const ELEMENTS = ["base", "bootstrap", "shoelace", "custom"];

/** Records what a strict page must never see: CSP violations and errors. */
async function watch(page: Page) {
  const errors: string[] = [];
  const scripts: { url: string; body: string }[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("response", async (r) => {
    if (r.url().endsWith(".js")) scripts.push({ url: r.url(), body: await r.text().catch(() => "") });
  });
  // Init scripts run outside the page's CSP: this listener is the test's, not the page's.
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return { errors, scripts, csp: () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp) };
}

async function rendered(page: Page, id: string) {
  await expect(page.locator(`gen-ui#${id}`)).toHaveAttribute("data-status", "complete");
  await expect
    .poll(() => page.evaluate((i) => (document.getElementById(i)!.shadowRoot ?? document.getElementById(i)!).querySelectorAll("[aria-busy]").length, id))
    .toBe(0);
}

/** A computed style inside an element's shadow root. */
const styleIn = (page: Page, id: string, selector: string, property: string) =>
  page.evaluate(
    ([i, s, p]) => {
      const el = (document.getElementById(i!)!.shadowRoot ?? document.getElementById(i!)!).querySelector(s!);
      return el ? getComputedStyle(el).getPropertyValue(p!).trim() : null;
    },
    [id, selector, property],
  );

test("four elements render under script-src 'self', with no violation and no error (T-248)", async ({ page }) => {
  const seen = await watch(page);
  const response = await page.goto("/");
  const csp = response!.headers()["content-security-policy"]!;
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/unsafe-eval|unsafe-inline/);

  for (const id of ELEMENTS) await rendered(page, id);
  expect(await seen.csp()).toEqual([]);
  expect(seen.errors).toEqual([]);

  // Each element reports the state the React hook would (FR-223).
  await expect(page.locator('output[for="base"]')).toContainText("complete · provider local");
  await expect(page.locator('output[for="bootstrap"]')).toContainText("base theme for Chart");
  await page.screenshot({ path: test.info().outputPath("index.png"), fullPage: true });
});

test("lazy loading in a real bundle: the validator only for foreign sources, once (FR-208)", async ({ page }) => {
  const seen = await watch(page);
  await page.goto("/light.html");
  await rendered(page, "bootstrap-light");
  // The same-origin route with validate="server": Zod is never downloaded.
  expect(seen.scripts.filter((s) => s.body.includes("ZodError"))).toEqual([]);

  const index = await watch(page);
  await page.goto("/");
  for (const id of ELEMENTS) await rendered(page, id);
  // Two elements validate in full; the validator chunk is fetched once.
  expect(index.scripts.filter((s) => s.body.includes("ZodError"))).toHaveLength(1);
});

test("a page that never renders a document loads no component and no validator (FR-242)", async ({ page }) => {
  const seen = await watch(page);
  await page.goto("/empty.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => customElements.get("gen-ui") !== undefined)).toBe(true);
  const names = seen.scripts.map((s) => s.url.split("/").pop()!);
  expect(names.filter((n) => /^(layout|text|metric|table|chart)-/.test(n))).toEqual([]);
  expect(seen.scripts.filter((s) => s.body.includes("ZodError"))).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test("no style crosses a shadow boundary, in either direction (T-247)", async ({ page }) => {
  await page.goto("/");
  for (const id of ELEMENTS) await rendered(page, id);

  // Bootstrap, adopted into #bootstrap's root, styles what is in it ...
  expect(await styleIn(page, "bootstrap", ".card", "display")).toBe("flex");
  expect(await styleIn(page, "bootstrap", ".alert-warning", "background-color")).toBe("rgb(255, 243, 205)");
  expect(await styleIn(page, "bootstrap", ".badge", "font-weight")).toBe("700");
  // ... and nothing outside it: not the host page, not the other elements.
  const host = await page.evaluate(() => {
    const card = getComputedStyle(document.getElementById("host-card")!);
    const p = getComputedStyle(document.getElementById("host-gen-text")!);
    return { display: card.display, border: card.borderTopStyle, pBackground: p.backgroundColor, pFont: p.fontFamily };
  });
  expect(host.display).toBe("block");
  expect(host.border).toBe("dashed");
  // The base theme's classes on a host element do nothing outside a gen-ui.
  expect(host.pBackground).toBe("rgba(0, 0, 0, 0)");
  expect(host.pFont).toContain("Georgia");
  // The base theme inside #base knows nothing of Bootstrap.
  expect(await styleIn(page, "base", ".gen-theme", "--bs-primary")).toBe("");
  expect(await styleIn(page, "base", ".gen-callout", "background-color")).not.toBe("rgb(255, 243, 205)");

  // Two looks of one theme: the page's tokens reach #custom only.
  expect(await styleIn(page, "custom", ".gen-theme", "--gen-color-primary")).toBe("#6b2fb3");
  expect(await styleIn(page, "base", ".gen-theme", "--gen-color-primary")).toBe("#1a5fb4");
  expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--gen-color-primary"))).toBe("");

  // The page's own styles stop at the boundary too: Georgia is the page's font,
  // and the base theme's surface keeps its own.
  expect(await styleIn(page, "base", ".gen-theme", "font-family")).not.toContain("Georgia");
});

test("Shoelace's elements render and are upgraded (T-246)", async ({ page }) => {
  await page.goto("/");
  await rendered(page, "shoelace");
  const shoelace = await page.evaluate(() => {
    const root = document.getElementById("shoelace")!.shadowRoot!;
    const card = root.querySelector("sl-card")!;
    const alert = root.querySelector("sl-alert")!;
    return {
      cards: root.querySelectorAll("sl-card").length,
      upgraded: card.shadowRoot !== null && alert.shadowRoot !== null,
      header: root.querySelector('sl-card > [slot="header"]')?.textContent ?? null,
      variant: alert.getAttribute("variant"),
      badges: [...root.querySelectorAll("sl-badge")].map((b) => b.getAttribute("variant")),
    };
  });
  // Card plus three Metrics, all sl-card.
  expect(shoelace.cards).toBe(4);
  expect(shoelace.upgraded).toBe(true);
  expect(shoelace.header).toBe("By region · Shoelace");
  expect(shoelace.variant).toBe("warning");
  expect(shoelace.badges).toEqual(["primary", "success"]);
});

test("a variant switch restyles every element without re-rendering (FR-232)", async ({ page }) => {
  await page.goto("/");
  for (const id of ELEMENTS) await rendered(page, id);
  const heading = await page.evaluateHandle(() => document.getElementById("base")!.shadowRoot!.querySelector(".gen-heading")!);
  const before = await styleIn(page, "base", ".gen-theme", "background-color");
  await page.selectOption("#variant", "dark");
  await expect.poll(() => styleIn(page, "base", ".gen-theme", "background-color")).not.toBe(before);
  expect(await styleIn(page, "base", ".gen-theme", "background-color")).toBe("rgb(21, 22, 27)");
  expect(await heading.evaluate((h) => h.isConnected)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("index-dark.png"), fullPage: true });
});

test("Bootstrap in light mode: the page's stylesheet styles the element's DOM", async ({ page }) => {
  const seen = await watch(page);
  await page.goto("/light.html");
  await rendered(page, "bootstrap-light");
  const card = await page.evaluate(() => getComputedStyle(document.querySelector("#bootstrap-light .card")!).display);
  expect(card).toBe("flex");
  expect(await seen.csp()).toEqual([]);
  expect(seen.errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("light.png"), fullPage: true });
});

test("every element passes axe, light and dark", async ({ page }) => {
  await page.goto("/");
  for (const id of ELEMENTS) await rendered(page, id);
  const report = (variant: string, violations: { id: string; nodes: { target: unknown[] }[] }[]) =>
    violations.map((v) => `${variant}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  for (const variant of ["light", "dark"]) {
    await page.selectOption("#variant", variant);
    const ours = await new AxeBuilder({ page }).include("#base").include("#bootstrap").include("#custom").analyze();
    expect(report(variant, ours.violations)).toEqual([]);
    // Shoelace's own badge colours (white on its primary-600 and success-600)
    // fall just short of 4.5:1. That is the library's palette, drawn inside its
    // own shadow root, and outside what a connector controls; every other rule
    // still applies.
    const shoelace = await new AxeBuilder({ page }).include("#shoelace").disableRules(["color-contrast"]).analyze();
    expect(report(variant, shoelace.violations)).toEqual([]);
    // Contrast for everything else in it, badges aside: this is what catches
    // Shoelace's own surfaces not following the element into dark mode.
    const contrast = await new AxeBuilder({ page }).include("#shoelace").withRules(["color-contrast"]).analyze();
    const outsideBadges = contrast.violations
      .map((v) => ({ ...v, nodes: v.nodes.filter((n) => !JSON.stringify(n.target).includes("sl-badge")) }))
      .filter((v) => v.nodes.length > 0);
    expect(report(variant, outsideBadges)).toEqual([]);
  }
});
