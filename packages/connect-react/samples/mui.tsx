/**
 * A sample MUI connector (T-251): eleven of the twelve components as MUI's own,
 * Chart left to the base theme (MUI has no chart in its core package), which
 * the element reports as a fallback.
 *
 * Each component is ordinary React. It receives validated props, and
 * `children` — where the renderer's children go. Each root carries the role the
 * contract names for its type, explicitly, as the base theme does.
 *
 * Not published: a starting point to copy, and what the conformance suite runs.
 */
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { Connector } from "relax-ui-render";
import { reactConnector, type GenProps } from "../src/index.js";

type P<T> = GenProps<T>;
const TONE = { info: "info", success: "success", warning: "warning", danger: "error" } as const;
const GAP = { sm: 1, md: 2, lg: 3 } as const;

const components = {
  Stack: ({ direction, gap, children }: P<{ direction?: "row" | "column"; gap?: keyof typeof GAP }>) => (
    <Stack role="group" direction={direction ?? "column"} spacing={GAP[gap ?? "md"]} useFlexGap sx={{ flexWrap: "wrap" }}>
      {children}
    </Stack>
  ),
  Grid: ({ columns, children }: P<{ columns?: number }>) => (
    <Box role="group" sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: `repeat(${columns ?? 3}, 1fr)` } }}>
      {children}
    </Box>
  ),
  Card: ({ title, subtitle, children }: P<{ title?: string; subtitle?: string }>) => (
    <Card role="region" aria-label={title} variant="outlined">
      {title !== undefined && <CardHeader title={title} subheader={subtitle} />}
      <CardContent>{children}</CardContent>
    </Card>
  ),
  Heading: ({ text, level }: P<{ text?: string; level?: number }>) => {
    const l = Math.min(Math.max(level ?? 2, 1), 4) as 1 | 2 | 3 | 4;
    return (
      <Typography role="heading" aria-level={l} variant={(["h4", "h5", "h6", "subtitle1"] as const)[l - 1]} component={`h${l}`}>
        {text}
      </Typography>
    );
  },
  Text: ({ text, tone }: P<{ text?: string; tone?: "default" | "muted" }>) => (
    <Typography role="paragraph" variant="body1" color={tone === "muted" ? "text.secondary" : "text.primary"} sx={{ whiteSpace: "pre-line" }}>
      {text}
    </Typography>
  ),
  Metric: ({ label, value, trend, caption }: P<{ label?: string; value?: string; trend?: "up" | "down" | "flat"; caption?: string }>) => (
    <Paper role="group" aria-label={label} variant="outlined" sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="h5" component="p">
        {value}
        {trend && (
          <Box component="span" role="img" aria-label={`trend ${trend}`} sx={{ ml: 1, fontSize: "0.7em", color: trend === "up" ? "success.main" : trend === "down" ? "error.main" : "text.secondary" }}>
            {trend === "up" ? "▲" : trend === "down" ? "▼" : "▬"}
          </Box>
        )}
      </Typography>
      {caption !== undefined && <Typography variant="caption" color="text.secondary">{caption}</Typography>}
    </Paper>
  ),
  List: ({ items, ordered }: P<{ items?: string[]; ordered?: boolean }>) => (
    <List role="list" component={ordered ? "ol" : "ul"} dense sx={{ listStyle: ordered ? "decimal" : "disc", pl: 3 }}>
      {(items ?? []).map((item, i) => (
        <ListItem key={i} sx={{ display: "list-item", py: 0 }}>{item}</ListItem>
      ))}
    </List>
  ),
  Table: ({ columns, rows, caption }: P<{ columns?: string[]; rows?: string[][]; caption?: string }>) => (
    <Table role="table" size="small">
      {caption !== undefined && <caption>{caption}</caption>}
      <TableHead>
        <TableRow>{(columns ?? []).map((c, i) => <TableCell key={i} scope="col">{c}</TableCell>)}</TableRow>
      </TableHead>
      <TableBody>
        {(rows ?? []).map((row, r) => (
          <TableRow key={r}>{(columns ?? []).map((_, c) => <TableCell key={c}>{row[c] ?? ""}</TableCell>)}</TableRow>
        ))}
      </TableBody>
    </Table>
  ),
  Callout: ({ tone, title, body }: P<{ tone?: keyof typeof TONE; title?: string; body?: string }>) => (
    <Alert role="note" severity={TONE[tone ?? "info"]}>
      <AlertTitle>{title}</AlertTitle>
      {body}
    </Alert>
  ),
  Badge: ({ text, tone }: P<{ text?: string; tone?: "neutral" | keyof typeof TONE }>) => (
    <Chip role="note" size="small" label={text} color={tone === undefined || tone === "neutral" ? "default" : TONE[tone]} sx={{ alignSelf: "flex-start" }} />
  ),
  Link: ({ label, href }: P<{ label?: string; href?: string }>) => (
    // `href` passed the contract's URL guard, and the renderer's guard again.
    <MuiLink role="link" href={href} target="_blank" rel="noopener noreferrer nofollow">
      {label}
    </MuiLink>
  ),
};

export const MUI_TYPES = Object.keys(components);

export function mui(): Connector {
  return reactConnector({ name: "mui", implementations: components as never });
}
