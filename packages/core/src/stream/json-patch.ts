// Moved to `relax-ui-protocol` in feature 003 so the browser can use it without
// the server half. Kept so every existing import path keeps working.
export {
  applyPatch,
  decodePointerSegment,
  diffJson,
  encodePointerSegment,
  fromPointer,
  toPointer,
} from "relax-ui-protocol";
export type { JsonPatchOp } from "relax-ui-protocol";
