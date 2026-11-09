import { RelaxUIError } from "./errors.js";
import { sourceKind, type Source } from "./sources.js";

/**
 * How much of a document the browser validates.
 *
 * - `full` — the default. Every frame is checked against the schema before it
 *   is rendered.
 * - `server` — the browser trusts the server's validation and loads no
 *   validator. Allowed only for a same-origin URL.
 */
export type ValidationTier = "full" | "server";

/**
 * Decides the tier for a source, refusing what Constitution IV forbids.
 *
 * Origin is the boundary because it is the only one a browser can check that
 * the page cannot forge (research R4): a same-origin URL is served by the
 * application that served the page, and if that is compromised so is the page.
 * A document, a byte stream, a socket or another origin could have come from
 * anywhere.
 *
 * A refusal is a `config_invalid` error, never a quiet upgrade to `full`: a
 * silent upgrade would hide the mistake from the person who made it (S1).
 *
 * @param pageOrigin the page's origin; `location.origin` when omitted.
 */
export function resolveValidation(
  source: Source,
  requested: ValidationTier | undefined,
  pageOrigin: string | undefined = currentOrigin(),
): ValidationTier {
  const kind = sourceKind(source);
  if (requested === undefined || requested === "full") return "full";
  if (requested !== "server") {
    throw new RelaxUIError({
      code: "config_invalid",
      message: `Unknown validation tier "${String(requested)}"; use "full" or "server".`,
    });
  }

  if (kind === "url") {
    const url = (source as { url: string }).url;
    if (isSameOriginUrl(url, pageOrigin)) return "server";
    throw new RelaxUIError({
      code: "config_invalid",
      message:
        `validate: "server" is allowed only for a URL on this page's own origin; ${url} is not. ` +
        `Remove it to validate the document in the browser.`,
    });
  }
  throw new RelaxUIError({
    code: "config_invalid",
    message:
      `validate: "server" is allowed only for a same-origin URL; this source is a ${kind}, ` +
      `which could have come from anywhere. Remove it to validate the document in the browser.`,
  });
}

/**
 * True when `url` is http(s) on `pageOrigin`. A relative URL always is.
 *
 * Without a page origin (server rendering, a test runner) only a relative URL
 * counts: there is nothing to compare an absolute one against.
 */
export function isSameOriginUrl(url: string, pageOrigin: string | undefined = currentOrigin()): boolean {
  // Placeholder base for "no page": a reserved name nothing can be served from.
  const base = pageOrigin ?? "http://relative.invalid";
  let resolved: URL;
  let page: URL;
  try {
    resolved = new URL(url, base);
    page = new URL(base);
  } catch {
    return false;
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return false;
  return resolved.origin === page.origin;
}

function currentOrigin(): string | undefined {
  const location = (globalThis as { location?: { origin?: string } }).location;
  const origin = location?.origin;
  // "null" is the origin of file: pages and sandboxed frames: no origin at all.
  return typeof origin === "string" && origin !== "null" ? origin : undefined;
}
