import { Chart } from "./components/chart.js";
import { Card, Grid, Stack } from "./components/layout.js";
import { Metric } from "./components/metric.js";
import { Table } from "./components/table.js";
import { Badge, Callout, Heading, Link, List, Text } from "./components/text.js";
import type { BaseTemplates } from "./props.js";

/**
 * The base theme's twelve components, all loaded up front (FR-230).
 *
 * Each takes props that have passed the contract's schema, and returns markup
 * as data. Styling is by class only; every class reads design tokens
 * (`css.ts`), so nothing here knows about colour, variant or density, and a
 * variant switch never re-renders (FR-232).
 *
 * Each root carries the role the contract names for its component (FR-214),
 * explicitly even where the element implies it, so a connector replacing the
 * element cannot lose it unnoticed.
 *
 * For lazy loading, use `baseLoaders` instead: the same templates, one chunk
 * per group, fetched when a document first uses them.
 */
export const baseTemplates: BaseTemplates = {
  Stack,
  Grid,
  Card,
  Heading,
  Text,
  Metric,
  List,
  Table,
  Callout,
  Badge,
  Link,
  Chart,
};

export { describeChart } from "./components/describe.js";
export type { BaseComponentName, BaseProps, BaseTemplates, Template } from "./props.js";
