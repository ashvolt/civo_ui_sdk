# relax-ui-theme-base

The base theme for the relaxAI Generative UI SDK: CSS design tokens with
**light, dark and compact** variants, and the twelve standard components as
framework-neutral markup templates. No dependencies.

## Use with React

```tsx
import "relax-ui-theme-base/theme.css";
import { baseComponents, createGenerativeRenderer, GenerativeTheme } from "relax-ui-react";

const Dashboard = createGenerativeRenderer(contract, baseComponents);

<GenerativeTheme variant="dark" density="compact">
  <Dashboard node={object?.root} />
</GenerativeTheme>;
```

`variant` is `light`, `dark` or `auto` (follows the system); `density` is
`comfortable` or `compact`. Switching either changes two attributes on the
themed root: the document restyles without re-rendering.

## Theming

Override tokens; never selectors. Every colour a component uses is a custom
property on `.gen-theme`:

```css
.gen-theme {
  --gen-color-primary: #6b21a8;
  --gen-radius-l: 4px;
  --gen-font-family: "Inter", sans-serif;
}
```

| Group | Tokens |
|---|---|
| Colour roles | `--gen-color-surface`, `-surface-variant`, `-on-surface`, `-on-surface-variant`, `-outline`, `-primary`, `-on-primary` |
| Tones | `--gen-color-{neutral,info,success,warning,danger}-container`, `--gen-color-on-…-container`, and `--gen-color-{info,success,warning,danger}` |
| Chart series | `--gen-color-chart-1` … `-4` |
| Type | `--gen-font-family`, `--gen-font-size-1` … `-5`, `--gen-line-height` |
| Space and shape | `--gen-space-unit` (density scales it), `--gen-radius-{s,m,l}` |

Names follow Material 3's colour roles where one exists, so a host already
using Material tokens can alias rather than restate them.

## Guarantees, each tested

- Component CSS contains no literal colour; only tokens do.
- Every text pair meets WCAG 2.2 AA (4.5:1) and every chart colour 3:1, in
  light, dark and compact. axe also audits the rendered dashboard in the
  reference app's browser tests.
- Every selector is scoped under `.gen-theme`: nothing else on the page is styled.
- Each component's root carries the role its contract names.
- Templates take props only. Model text is a text node or an attribute value,
  never markup; tags and attributes are from a fixed allowlist.
- Chart is plain SVG, with the data described in words for screen readers.

## Templates

A template returns markup as data:

```ts
import { baseTemplates, CHILDREN, h } from "relax-ui-theme-base";

const Pill = (p: { text: string }) => h("span", { class: "gen-badge gen-tone--info", role: "note" }, p.text);
```

`relax-ui-react`'s `fromTemplates` turns templates into React components, and
`relax-ui-render`'s `DomRenderer` draws the same templates without a framework.
One implementation serves every host.

## Lazy loading

`baseLoaders` holds the same twelve components as `baseTemplates`, fetched on
first use in five chunks: layout (Stack, Grid, Card), text (Heading, Text, List,
Link, Badge, Callout), Metric, Table and Chart. Importing `baseLoaders` pulls in
none of them, and none of the CSS text either (tested at the bundle level).

Size: 4.0 KB gzip; about 4.5 KB added to a React app that uses it (`pnpm size`).
