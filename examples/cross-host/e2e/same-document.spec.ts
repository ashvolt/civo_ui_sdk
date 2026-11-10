import { expect, test, type Page } from "@playwright/test";

/**
 * T-256: the same document, from the same route, drawn by the base theme in
 * four hosts — a plain HTML page, a Vue app and an Angular app through
 * `<gen-ui>`, and a React page through `relax-ui-react` — is the same
 * structure in each: the same elements, attributes, roles and text, in the
 * same order.
 *
 * Spec scenario 6: "each renders the same document without any
 * framework-specific package". The React page proves the two renderers (the
 * DOM backend and React) agree as well.
 */

const HOSTS = [
  { name: "html", url: "http://127.0.0.1:3300/", root: { element: "base" } },
  { name: "vue", url: "http://127.0.0.1:3301/", root: { element: "base" } },
  { name: "angular", url: "http://127.0.0.1:3302/", root: { element: "base" } },
  { name: "react", url: "http://127.0.0.1:3300/react.html", root: { react: "react-base" } },
] as const;

/**
 * The rendered document in canonical form: tags, attributes sorted, text, in
 * order. Comments (the renderer's markers for skipped nodes) are dropped.
 */
async function structure(page: Page, root: { element?: string; react?: string }): Promise<string> {
  return page.evaluate((r) => {
    const start = r.element
      ? document.getElementById(r.element)!.shadowRoot!.querySelector(".gen-theme")!.firstElementChild!
      : document.getElementById(r.react!)!.firstElementChild!;
    const out: string[] = [];
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if ((node as Text).data !== "") out.push(JSON.stringify((node as Text).data));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      const attrs = [...el.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort();
      out.push(`<${el.localName}${attrs.length ? " " + attrs.join(" ") : ""}>`);
      // Adjacent text nodes are one run of text, however a renderer split them.
      el.normalize();
      for (const child of el.childNodes) walk(child);
      out.push(`</${el.localName}>`);
    };
    walk(start);
    return out.join("\n");
  }, root);
}

async function ready(page: Page, root: { element?: string; react?: string }) {
  if (root.element) {
    await expect(page.locator(`gen-ui#${root.element}`)).toHaveAttribute("data-status", "complete");
    await expect
      .poll(() => page.evaluate((id) => document.getElementById(id)!.shadowRoot!.querySelectorAll("[aria-busy]").length, root.element!))
      .toBe(0);
  } else {
    await expect(page.locator(`#${root.react}`)).toHaveAttribute("data-status", "complete");
  }
}

test("one document, four hosts, one structure (T-256)", async ({ page }) => {
  const results: Record<string, string> = {};
  for (const host of HOSTS) {
    await page.goto(host.url);
    await ready(page, host.root);
    results[host.name] = await structure(page, host.root);
  }
  const reference = results.html!;
  expect(reference).toContain("By region · route");
  expect(reference.split("\n").length).toBeGreaterThan(100);
  for (const host of ["vue", "angular", "react"]) {
    expect(results[host], `${host} differs from the plain HTML host`).toBe(reference);
  }
});
