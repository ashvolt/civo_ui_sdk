// Moved to `relax-ui-protocol` in feature 003 so the browser can use it without
// the server half. Kept so every existing import path keeps working.
export { isRelaxUIError, RelaxUIError } from "relax-ui-protocol";
export type { RelaxUIErrorCode, RelaxUIErrorOptions } from "relax-ui-protocol";
