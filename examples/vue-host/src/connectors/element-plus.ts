/**
 * A sample Element Plus connector (T-253), through `relax-ui-connect-vue`.
 *
 * Six components become Element Plus's own: Card, Metric, Callout, Badge, Link
 * and Text. The rest (layout, headings, lists, tables, charts) are left to the
 * base theme, which the element reports as fallbacks. Each root carries the
 * role the contract names for its type, as a fallthrough attribute.
 *
 * Plain render functions, so the page needs no template compiler and no
 * `unsafe-eval`. Element Plus's stylesheet is a file the page links.
 */
import { ElAlert, ElCard, ElLink, ElTag, ElText } from "element-plus";
import { defineComponent, h, type App, type PropType } from "vue";
import { vueConnector, type VueConnectorOptions } from "relax-ui-connect-vue";
import type { Connector } from "relax-ui-element";

const TONE = { info: "info", success: "success", warning: "warning", danger: "error" } as const;
const TAG = { neutral: "info", info: "primary", success: "success", warning: "warning", danger: "danger" } as const;

const str = { type: String, required: false } as const;

/**
 * Element Plus's tag never wraps and its text keeps a long word whole; either
 * would run out of its box. Set through the CSSOM, which a strict
 * `style-src` allows.
 */
const WRAP = { overflowWrap: "anywhere", whiteSpace: "normal", height: "auto", textAlign: "start" } as const;

const Card = defineComponent({
  props: { title: str, subtitle: str },
  setup(props, { slots }) {
    return () =>
      h(
        ElCard,
        { role: "region", "aria-label": props.title, shadow: "never" },
        {
          header:
            props.title === undefined
              ? undefined
              : () => [h("strong", props.title), props.subtitle ? h(ElText, { type: "info", size: "small", class: "gen-ep-subtitle" }, () => ` ${props.subtitle}`) : null],
          default: slots.default,
        },
      );
  },
});

const Metric = defineComponent({
  props: { label: str, value: str, caption: str, trend: { type: String as PropType<"up" | "down" | "flat">, required: false } },
  setup(props) {
    const glyph = { up: "▲", down: "▼", flat: "▬" } as const;
    const tone = { up: "success", down: "danger", flat: "info" } as const;
    return () =>
      h(ElCard, { role: "group", "aria-label": props.label, shadow: "never", bodyStyle: { padding: "12px 16px" } }, () => [
        h(ElText, { tag: "p", type: "info", size: "small", style: WRAP }, () => props.label),
        h(ElText, { tag: "p", size: "large", class: "gen-ep-value", style: WRAP }, () => [
          props.value,
          props.trend
            ? h(ElText, { type: tone[props.trend], role: "img", "aria-label": `trend ${props.trend}`, class: "gen-ep-trend" }, () => ` ${glyph[props.trend!]}`)
            : null,
        ]),
        props.caption === undefined ? null : h(ElText, { tag: "p", type: "info", size: "small", style: WRAP }, () => props.caption),
      ]);
  },
});

const Callout = defineComponent({
  props: { title: str, body: str, tone: { type: String as PropType<keyof typeof TONE>, required: false } },
  setup(props) {
    return () =>
      h(ElAlert, { role: "note", type: TONE[props.tone ?? "info"], title: props.title, description: props.body, closable: false, showIcon: true });
  },
});

const Badge = defineComponent({
  props: { text: str, tone: { type: String as PropType<keyof typeof TAG>, required: false } },
  setup(props) {
    return () => h(ElTag, { role: "note", type: TAG[props.tone ?? "neutral"], size: "small", disableTransitions: true, style: WRAP }, () => props.text);
  },
});

const Link = defineComponent({
  props: { label: str, href: str },
  setup(props) {
    // `href` passed the contract's URL guard, and the renderer's guard again.
    return () => h(ElLink, { role: "link", href: props.href, target: "_blank", rel: "noopener noreferrer nofollow", type: "primary" }, () => props.label);
  },
});

const Text = defineComponent({
  props: { text: str, tone: { type: String as PropType<"default" | "muted">, required: false } },
  setup(props) {
    return () => h(ElText, { tag: "p", role: "paragraph", type: props.tone === "muted" ? "info" : undefined, class: "gen-ep-text", style: WRAP }, () => props.text);
  },
});

const implementations: VueConnectorOptions["implementations"] = { Card, Metric, Callout, Badge, Link, Text };

export const ELEMENT_PLUS_TYPES = Object.keys(implementations);

export function elementPlus(app?: App): Connector {
  return vueConnector({ name: "element-plus", ...(app ? { app } : {}), implementations });
}
