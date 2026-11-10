# relax-ui-connect-react

Render `<gen-ui>` documents with React components, such as MUI, Chakra or your
own design system. React and React DOM are the only peers.

```tsx
import { reactConnector, type GenProps } from "relax-ui-connect-react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";

function GenCard({ title, children }: GenProps<{ title?: string }>) {
  return (
    <Card role="region" aria-label={title}>
      <CardHeader title={title} />
      <CardContent>{children}</CardContent>
    </Card>
  );
}

el.setAttribute("mode", "light"); // React libraries style the page, not a shadow root
el.connectors = [reactConnector({ name: "mui", implementations: { Card: GenCard } })];
```

- A component receives the node's **validated** props and `children`.
  `children` is where the renderer draws the node's children, so render it
  where they belong. Never render model data you were not given as a prop.
- Give each component's root the role the contract names for its type
  (`standardContract.role(type)`). The conformance suite checks it.
- A type you do not implement falls back to the base theme, and the element
  reports it in `state.fallbacks`.
- `lazyComponent(() => import("./GenTable"))` loads a component on first use.

Each node gets its own React root, rendered synchronously. In Chromium, 300
nodes render completely in 14 ms, and the worst streamed frame is 6 ms. A shared
root with portals was slower (measurements in research.md, R5).

A full MUI sample covering eleven of the twelve components is in
[samples/mui.tsx](samples/mui.tsx). It passes the same conformance suite as every
other connector.
