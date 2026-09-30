"use client";

import type { GenerativeComponentProps } from "relax-ui-react";
import { createGenerativeRenderer } from "relax-ui-react";
import { dashboardRegistry } from "./ui-registry";

/**
 * The implementations behind the vocabulary.
 *
 * Every component receives props that have already passed its schema twice —
 * once on the server before the frame was sent, once in the renderer before it
 * was called — so the bodies here are plain presentational React with no
 * defensive checks and no `unknown` narrowing.
 *
 * Note what is absent: no `dangerouslySetInnerHTML`, no spread of model props
 * onto a DOM element, no computed event handlers. Model output reaches the DOM
 * only as text content or as an attribute the component chose deliberately.
 */

function Stack({ props, children }: GenerativeComponentProps<{ gap: "sm" | "md" | "lg"; heading?: string }>) {
  const gap = { sm: "0.5rem", md: "1rem", lg: "1.75rem" }[props.gap];
  return (
    <section style={{ display: "flex", flexDirection: "column", gap }}>
      {props.heading ? <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{props.heading}</h2> : null}
      {children}
    </section>
  );
}

function Grid({ props, children }: GenerativeComponentProps<{ columns: number }>) {
  return (
    <div
      style={{
        display: "grid",
        gap: "1rem",
        gridTemplateColumns: `repeat(auto-fit, minmax(${Math.floor(960 / props.columns)}px, 1fr))`,
      }}
    >
      {children}
    </div>
  );
}

const TREND_GLYPH = { up: "▲", down: "▼", flat: "—" } as const;

function Metric({
  props,
}: GenerativeComponentProps<{
  label: string;
  value: string;
  trend?: "up" | "down" | "flat";
  caption?: string;
}>) {
  return (
    <article style={card}>
      <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{props.label}</div>
      <div style={{ fontSize: "1.9rem", fontWeight: 600, lineHeight: 1.1 }}>
        {props.value}
        {props.trend ? (
          <span style={{ fontSize: "1rem", marginLeft: "0.4rem" }} aria-label={`trend ${props.trend}`}>
            {TREND_GLYPH[props.trend]}
          </span>
        ) : null}
      </div>
      {props.caption ? (
        <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{props.caption}</div>
      ) : null}
    </article>
  );
}

function Callout({
  props,
}: GenerativeComponentProps<{ tone: "info" | "success" | "warning"; title: string; body: string }>) {
  const accent = { info: "#2b6cb0", success: "#2f855a", warning: "#b7791f" }[props.tone];
  return (
    <aside style={{ ...card, borderLeft: `4px solid ${accent}` }}>
      <strong>{props.title}</strong>
      <p style={{ margin: "0.35rem 0 0", color: "var(--muted)" }}>{props.body}</p>
    </aside>
  );
}

function BarList({
  props,
}: GenerativeComponentProps<{ title: string; items: { label: string; value: number }[] }>) {
  const max = Math.max(...props.items.map((item) => item.value), 1);
  return (
    <article style={card}>
      <div style={{ fontWeight: 600, marginBottom: "0.6rem" }}>{props.title}</div>
      {props.items.map((item) => (
        <div key={item.label} style={{ display: "grid", gridTemplateColumns: "10rem 1fr 4rem", gap: "0.5rem", alignItems: "center", marginBottom: "0.35rem" }}>
          <span style={{ fontSize: "0.85rem" }}>{item.label}</span>
          <span style={{ background: "var(--bar-track)", borderRadius: 4, height: 8 }}>
            <span
              style={{
                display: "block",
                width: `${(item.value / max) * 100}%`,
                background: "var(--bar-fill)",
                borderRadius: 4,
                height: 8,
              }}
            />
          </span>
          <span style={{ fontSize: "0.85rem", textAlign: "right" }}>{item.value}</span>
        </div>
      ))}
    </article>
  );
}

function Prose({ props }: GenerativeComponentProps<{ text: string }>) {
  return <p style={{ margin: 0, lineHeight: 1.6, color: "var(--muted)" }}>{props.text}</p>;
}

function SourceLink({ props }: GenerativeComponentProps<{ label: string; href: string }>) {
  // `href` came through `urlString()`, so its scheme and host are already
  // constrained. `rel` is belt and braces for anything the guard let through.
  return (
    <a href={props.href} rel="noopener noreferrer nofollow" target="_blank" style={{ fontSize: "0.85rem" }}>
      {props.label}
    </a>
  );
}

const card: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "0.9rem 1rem",
};

export const Dashboard = createGenerativeRenderer(
  dashboardRegistry,
  {
    Stack,
    Grid,
    Metric,
    Callout,
    BarList,
    Prose,
    SourceLink,
  } as never,
  {
    // A node that fails a check is visible in development and silent in
    // production: a half-rendered dashboard is better than a broken page, but
    // you still want to know it happened.
    onInvalidNode: (failure) =>
      process.env.NODE_ENV === "development" ? (
        <div style={{ ...card, borderColor: "#c53030", fontSize: "0.8rem" }}>
          Rejected node <code>{failure.type}</code> ({failure.reason}
          {failure.detail ? `: ${failure.detail}` : ""})
        </div>
      ) : null,
    placeholder: <div style={{ ...card, color: "var(--muted)" }}>Waiting for the first frame…</div>,
  },
);
