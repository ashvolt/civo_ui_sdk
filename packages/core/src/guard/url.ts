import { RelaxUIError } from "../errors.js";

/**
 * URL sanitisation for model-authored UI.
 *
 * A generated component tree may contain hrefs and image sources chosen by a
 * model that just read untrusted retrieval context. `javascript:` and
 * `data:text/html` are script execution; everything else is a link.
 */
export const DEFAULT_URL_SCHEMES: readonly string[] = ["https:", "http:", "mailto:", "tel:"];

/** Data URLs are only ever allowed to carry these image types. */
export const DEFAULT_DATA_MEDIA_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

export interface UrlPolicy {
  schemes?: readonly string[];
  /** Allow `data:` URLs whose media type is in {@link DEFAULT_DATA_MEDIA_TYPES}. */
  allowDataImages?: boolean;
  /** When set, http(s) URLs must have a hostname matching one of these. */
  allowedHosts?: readonly string[];
}

const DATA_IMAGE = /^data:([a-z]+\/[a-z0-9.+-]+)\s*;/i;

/**
 * Returns a safe URL string, or `null` when the input must not be rendered.
 * Relative URLs (`/foo`, `./foo`, `#anchor`) are passed through unchanged —
 * they cannot escape the embedding origin.
 */
export function sanitizeUrl(raw: unknown, policy: UrlPolicy = {}): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "") return null;

  // Control characters are the classic `java\0script:` bypass.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  if (value.startsWith("/") || value.startsWith("#") || value.startsWith("./") || value.startsWith("../")) {
    return value;
  }

  if (/^data:/i.test(value)) {
    if (!policy.allowDataImages) return null;
    const match = DATA_IMAGE.exec(value);
    const mediaType = match?.[1]?.toLowerCase();
    return mediaType && DEFAULT_DATA_MEDIA_TYPES.includes(mediaType) ? value : null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Not absolute and not a recognised relative form: treat as a bare path.
    return /^[A-Za-z0-9._~\-/?&=%+]+$/.test(value) ? value : null;
  }

  const schemes = policy.schemes ?? DEFAULT_URL_SCHEMES;
  if (!schemes.includes(url.protocol)) return null;

  if (policy.allowedHosts && (url.protocol === "http:" || url.protocol === "https:")) {
    const host = url.hostname.toLowerCase();
    const ok = policy.allowedHosts.some((p) =>
      p.startsWith("*.") ? host.endsWith(p.slice(1)) && host.length > p.length - 1 : host === p,
    );
    if (!ok) return null;
  }

  return url.toString();
}

/** Strict variant for call sites that would rather fail than silently drop a link. */
export function assertSafeUrl(raw: unknown, policy: UrlPolicy = {}): string {
  const safe = sanitizeUrl(raw, policy);
  if (safe === null) {
    throw new RelaxUIError({
      code: "guard_rejected",
      message: "URL rejected by the generative-UI URL policy.",
    });
  }
  return safe;
}
