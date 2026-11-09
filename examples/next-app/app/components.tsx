"use client";

import { baseComponents, createGenerativeRenderer } from "relax-ui-react";
import { dashboardContract } from "./ui-registry";

/**
 * The implementations behind the vocabulary: the SDK's base theme.
 *
 * Every component receives props that have already passed its schema twice —
 * once on the server before the frame was sent, once in the renderer before it
 * was called. The base theme draws them from design tokens, so the variant
 * switcher on the page restyles the dashboard without re-rendering it.
 *
 * An application wanting its own look overrides tokens in CSS, or replaces one
 * component: `{ ...baseComponents, Metric: MyMetric }`.
 */
export const Dashboard = createGenerativeRenderer(dashboardContract, baseComponents as never, {
  // A node that fails a check is visible in development and silent in
  // production: a half-rendered dashboard is better than a broken page, but
  // you still want to know it happened.
  onInvalidNode: (failure) =>
    process.env.NODE_ENV === "development" ? (
      <div className="gen-callout gen-tone--danger" role="note">
        Rejected node <code>{failure.type}</code> ({failure.reason}
        {failure.detail ? `: ${failure.detail}` : ""})
      </div>
    ) : null,
  placeholder: <p className="gen-text gen-text--muted">Waiting for the first frame…</p>,
});
