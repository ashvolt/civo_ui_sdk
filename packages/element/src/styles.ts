import { components, tokens } from "relax-ui-theme-base";

/**
 * Getting the base theme, and a connector's stylesheets, to where the element
 * renders.
 *
 * The tokens are re-scoped to the element itself (`:host` in shadow mode,
 * a zero-specificity `:where(gen-ui)` in light mode), so a page restyles every
 * instance with an ordinary rule — `gen-ui { --gen-color-primary: … }` — and
 * switches a variant with an attribute: `<gen-ui variant="dark">`. Both act
 * through CSS alone, so neither re-renders (FR-232).
 *
 * Sheets are constructed once per page and adopted by every instance, so ten
 * elements parse the theme once (R3). Constructed sheets need no inline
 * `<style>`, which a strict `style-src` would refuse.
 */

const VARIANT_SELECTOR = /\.gen-theme\[data-gen-(variant|density)="([a-z]+)"\]/g;

/** The theme's CSS with its tokens scoped to `host`: ":host" or an element name. */
export function hostCss(host: string): string {
  const scope = (inner: string) => (host === ":host" ? `:host(${inner})` : `:where(${host}${inner})`);
  const base = host === ":host" ? ":host" : `:where(${host})`;
  const scoped = tokens
    .replace(VARIANT_SELECTOR, (_, axis: string, value: string) => scope(`[${axis}="${value}"]`))
    .replace(/^\.gen-theme \{/m, `${base} {`);
  return `${scoped}\n${components}`;
}

type StyleTarget = ShadowRoot | Document;

const constructed = new Map<string, CSSStyleSheet>();
const fetched = new Map<string, Promise<CSSStyleSheet>>();

function canAdopt(target: StyleTarget): boolean {
  return "adoptedStyleSheets" in target && typeof CSSStyleSheet === "function" && "replaceSync" in CSSStyleSheet.prototype;
}

function adopt(target: StyleTarget, sheet: CSSStyleSheet): void {
  if (!target.adoptedStyleSheets.includes(sheet)) target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
}

/** Adopts `css` into `target`, constructing the sheet once per `key`. */
export function adoptCss(target: StyleTarget, key: string, css: string): void {
  if (canAdopt(target)) {
    let sheet = constructed.get(key);
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      constructed.set(key, sheet);
    }
    adopt(target, sheet);
    return;
  }
  // Older engines: a `<style>` element, once per target.
  const parent = "head" in target ? target.head : target;
  if (parent.querySelector(`style[data-gen-ui="${key}"]`)) return;
  const style = (target.ownerDocument ?? (target as Document)).createElement("style");
  style.setAttribute("data-gen-ui", key);
  style.textContent = css;
  parent.appendChild(style);
}

/**
 * Adopts a connector's stylesheets into a shadow root. Each URL is fetched
 * once per page; every instance shares the parsed sheet. Resolves with the
 * URLs that failed.
 */
export async function adoptUrls(target: ShadowRoot, urls: readonly string[]): Promise<string[]> {
  const failed: string[] = [];
  if (!canAdopt(target)) {
    for (const url of urls) {
      if ([...target.querySelectorAll("link")].some((l) => l.getAttribute("href") === url)) continue;
      const link = target.ownerDocument.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      target.prepend(link);
    }
    return failed;
  }
  const sheets = await Promise.all(
    urls.map((url) => {
      let pending = fetched.get(url);
      if (!pending) {
        pending = fetch(url, { credentials: "same-origin" })
          .then((response) => {
            if (!response.ok) throw new Error(String(response.status));
            return response.text();
          })
          .then(async (css) => {
            const sheet = new CSSStyleSheet();
            // A global stylesheet declares its custom properties on `:root`,
            // which matches nothing inside a shadow root; `:host` is that
            // root's equivalent here.
            await sheet.replace(css.replace(/:root\b/g, ":host"));
            return sheet;
          });
        // A failure is not cached: the next document may try again.
        pending.catch(() => fetched.delete(url));
        fetched.set(url, pending);
      }
      return pending.catch(() => {
        failed.push(url);
        return undefined;
      });
    }),
  );
  // Library sheets go first, so the base theme (and the page's tokens) can
  // still be layered over them.
  const library = sheets.filter((s): s is CSSStyleSheet => s !== undefined);
  const rest = target.adoptedStyleSheets.filter((s) => !library.includes(s));
  target.adoptedStyleSheets = [...library, ...rest];
  return failed;
}
