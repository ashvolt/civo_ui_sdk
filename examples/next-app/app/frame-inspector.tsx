"use client";

import type { UIStreamEvent } from "relax-ui-core";
import { useEffect, useRef } from "react";

/**
 * The stream, made visible.
 *
 * The page normally shows only what the frames *build*. This shows the frames
 * themselves — one row per SSE event the route sent — which is the quickest way
 * to see what the SDK is doing: `meta` naming the mechanism that was
 * negotiated, a handful of snapshots while the document is smaller than a diff
 * of it would be, then a run of one-op patches as props fill in, and a terminal
 * `complete` or `error`.
 *
 * It is a debugging aid, and it is fed by the hook's `onFrame` observer rather
 * than by anything privileged: every value shown here has already passed the
 * server's validator, and is rendered as text.
 */

export interface FrameEntry {
  /** Position in the stream, from 1. */
  index: number;
  /** Milliseconds since the request was submitted. */
  atMs: number;
  /** Size of the frame's JSON, as a proxy for bytes on the wire. */
  bytes: number;
  event: UIStreamEvent<unknown>;
}

export function toFrameEntry(event: UIStreamEvent<unknown>, index: number, startedAt: number): FrameEntry {
  return {
    index,
    atMs: Math.round(performance.now() - startedAt),
    bytes: JSON.stringify(event).length,
    event,
  };
}

const KIND_COLOUR: Record<UIStreamEvent["type"], string> = {
  meta: "#6b46c1",
  snapshot: "#b7791f",
  patch: "#2b6cb0",
  complete: "#2f855a",
  error: "#c53030",
};

function describe(event: UIStreamEvent<unknown>): string {
  switch (event.type) {
    case "meta":
      return `${event.strategy} · ${event.model}${event.provider ? ` · ${event.provider}` : ""}`;
    case "snapshot":
      return "whole document";
    case "patch": {
      const last = event.ops[event.ops.length - 1];
      const more = event.ops.length > 1 ? ` (+${event.ops.length - 1})` : "";
      return last ? `${last.op} ${tail(last.path)}${more}` : "no ops";
    }
    case "complete":
      return `validated in ${Math.round(event.metadata.durationMs)}ms`;
    case "error":
      return event.error.code;
  }
}

/**
 * The end of a JSON pointer, which is the part that changes from row to row.
 * `/root/children/2/props/items/0/value` is all prefix until its last segments.
 */
function tail(path: string, max = 30): string {
  return path.length <= max ? path : `…${path.slice(-(max - 1))}`;
}

export function FrameInspector({ frames }: { frames: readonly FrameEntry[] }) {
  const list = useRef<HTMLOListElement>(null);

  // Follow the stream. Scrolling the list itself rather than calling
  // `scrollIntoView`, which would drag the whole page down on every frame.
  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [frames.length]);

  const count = (type: UIStreamEvent["type"]) => frames.filter((frame) => frame.event.type === type).length;
  const bytes = frames.reduce((sum, frame) => sum + frame.bytes, 0);
  const firstPaint = frames.find((frame) => frame.event.type === "patch" || frame.event.type === "snapshot");

  return (
    <aside
      aria-label="Stream frames"
      data-testid="frame-inspector"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--card)",
        fontSize: "0.78rem",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <header style={{ padding: "0.7rem 0.85rem", borderBottom: "1px solid var(--border)" }}>
        <strong style={{ fontSize: "0.85rem" }}>Stream frames</strong>
        <div data-testid="frame-stats" style={{ color: "var(--muted)", marginTop: "0.25rem" }}>
          {frames.length === 0 ? (
            "Nothing sent yet."
          ) : (
            <>
              <span data-testid="frame-count">{frames.length}</span> frames · {count("patch")} patch ·{" "}
              {count("snapshot")} snapshot · {(bytes / 1024).toFixed(1)} kB
              {firstPaint ? ` · first paint ${firstPaint.atMs}ms` : null}
            </>
          )}
        </div>
      </header>

      <ol
        ref={list}
        style={{
          listStyle: "none",
          margin: 0,
          padding: "0.35rem 0",
          overflowY: "auto",
          maxHeight: "28rem",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        {frames.map((frame) => (
          <li
            key={frame.index}
            data-frame-type={frame.event.type}
            style={{
              display: "grid",
              gridTemplateColumns: "3.2rem 4.6rem 1fr",
              gap: "0.4rem",
              padding: "0.12rem 0.85rem",
              alignItems: "baseline",
            }}
          >
            <span style={{ color: "var(--muted)", textAlign: "right" }}>
              {"seq" in frame.event ? `#${frame.event.seq}` : ""}
            </span>
            <span style={{ color: KIND_COLOUR[frame.event.type], fontWeight: 600 }}>{frame.event.type}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {describe(frame.event)}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
