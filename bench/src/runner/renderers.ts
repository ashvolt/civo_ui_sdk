import { a2uiJSONL, aiSdkJSON, jsonRenderJSONL, openuiLang, type Encoded } from "./contenders.ts";
import type { Dimension, Document } from "../workloads/generator.ts";

export interface RendererInfo {
  page: string;
  packages: Record<string, string>;
  /** False: soaked, not laddered. */
  ladders?: false;
  /** The renderer's wire format. Default: this SDK's SSE. */
  encode?: (frames: readonly Document[], dimension: Dimension) => Encoded;
  /** A contender, not this SDK. */
  contender?: true;
}

/** The renderers with a page, and the packages they exercise (research R11). */
export const RENDERERS: Record<string, RendererInfo> = {
  "ours-element": { page: "ours-element.html", packages: { "relax-ui-element": "workspace" } },
  "ours-react": { page: "ours-react.html", packages: { "relax-ui-react": "workspace", react: "19" } },
  "ours-angular-host": { page: "ours-angular-host.html", packages: { "relax-ui-element": "workspace", "@angular/core": "21.2.5" } },
  "ours-vue-host": { page: "ours-vue-host.html", packages: { "relax-ui-element": "workspace", vue: "3.5.45" } },
  // The element with a React framework connector: soaked, for its mounted
  // components; not laddered, since its markup adds the connector's mount
  // points around each component.
  "ours-connect-react": {
    page: "ours-connect-react.html",
    packages: { "relax-ui-element": "workspace", "relax-ui-connect-react": "workspace", react: "19" },
    ladders: false,
  },
  "json-render": {
    page: "json-render.html",
    packages: { "@json-render/core": "0.22.0", "@json-render/react": "0.22.0", react: "19" },
    encode: jsonRenderJSONL,
    contender: true,
  },
  openui: { page: "openui.html", packages: { "@openuidev/react-lang": "1.1.0", react: "19" }, encode: openuiLang, contender: true },
  "a2ui-lit": {
    page: "a2ui-lit.html",
    packages: { "@a2ui/web_core": "0.15.0", "@a2ui/lit": "0.15.0", lit: "3.3.3" },
    encode: a2uiJSONL,
    contender: true,
  },
  "a2ui-angular": {
    page: "a2ui-angular.html",
    packages: { "@a2ui/web_core": "0.15.0", "@a2ui/angular": "0.14.0", "@angular/core": "21.2.5" },
    encode: a2uiJSONL,
    contender: true,
  },
  "a2ui-react": {
    page: "a2ui-react.html",
    packages: { "@a2ui/web_core": "0.15.0", "@a2ui/react": "0.15.0", react: "19" },
    encode: a2uiJSONL,
    contender: true,
  },
  "ai-sdk": { page: "ai-sdk.html", packages: { ai: "7.0.166", "@ai-sdk/react": "4.0.170", react: "19" }, encode: aiSdkJSON, contender: true },
};
