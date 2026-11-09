// Moved to `relax-ui-protocol` in feature 003 so the browser can apply the same
// URL guard. Kept so every existing import path keeps working.
export { assertSafeUrl, DEFAULT_DATA_MEDIA_TYPES, DEFAULT_URL_SCHEMES, sanitizeUrl } from "relax-ui-protocol";
export type { UrlPolicy } from "relax-ui-protocol";
