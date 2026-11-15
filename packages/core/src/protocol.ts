// Moved to `relax-ui-protocol` in feature 003 so the browser can use it without
// the server half. Kept so every existing import path keeps working.
export {
  encodeUIStreamEvent,
  isUIStreamEvent,
  negotiateProtocol,
  UI_STREAM_ACCEPT,
  UI_STREAM_PROTOCOL_VERSION,
  UIStreamAccumulator,
} from "relax-ui-protocol";
export type {
  UIStreamCompleteEvent,
  UIStreamErrorEvent,
  UIStreamEvent,
  UIStreamMetaEvent,
  UIStreamProtocol,
  UIStreamPatchEvent,
  UIStreamSnapshotEvent,
} from "relax-ui-protocol";
