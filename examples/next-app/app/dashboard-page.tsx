"use client";

import { useGenerativeObject } from "relax-ui-react";
import { useState } from "react";
import { Dashboard } from "./components";
import type { UINode } from "relax-ui-core";

/**
 * The entire client side of the feature.
 *
 * `useGenerativeObject` holds no API key, speaks to no model, and parses no
 * model output — it consumes the validated event stream from `/api/ui`. The
 * object it exposes is partial while streaming and complete afterwards, so the
 * renderer can paint every frame without special-casing "not finished yet".
 */
export interface DashboardPageProps {
  /** e.g. "relaxAI (api.relax.ai)" or "local Ollama (127.0.0.1:11434)". */
  providerLabel: string;
  /** False in local mode. Drives the banner — never hidden. */
  isSovereign: boolean;
}

export default function DashboardPage({ providerLabel, isSovereign }: DashboardPageProps) {
  const [topic, setTopic] = useState("UK public cloud spend, 2024 vs 2025");
  const [audience, setAudience] = useState<"executive" | "engineering" | "finance">("executive");

  const { object, isStreaming, error, metadata, strategy, submit, stop } = useGenerativeObject<{
    root: UINode;
  }>({ api: "/api/ui" });

  return (
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "2.5rem 1.25rem" }}>
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Generative dashboards on relaxAI</h1>
        <p style={{ color: "var(--muted)", marginTop: "0.4rem" }}>
          The layout below is chosen by the model at request time, assembled only from components
          this application registered, and validated before a single byte reaches the browser.
        </p>

        {/*
          The endpoint is always stated, and local mode says plainly that it is
          not a sovereign one. A demo that blurred that line would undercut the
          thing the SDK is actually claiming.
        */}
        <p
          role={isSovereign ? undefined : "note"}
          style={{
            marginTop: "0.9rem",
            padding: "0.55rem 0.8rem",
            borderRadius: 8,
            fontSize: "0.85rem",
            border: `1px solid ${isSovereign ? "var(--border)" : "#b7791f"}`,
            background: isSovereign ? "transparent" : "rgba(183, 121, 31, 0.08)",
          }}
        >
          {isSovereign ? (
            <>
              Serving from <strong>{providerLabel}</strong> — UK jurisdiction, sovereignty guard
              enforcing its default allowlist.
            </>
          ) : (
            <>
              <strong>Local demo mode — {providerLabel}.</strong> Not a sovereign endpoint, and
              not what this SDK is for: it exists so the demo runs without a relaxAI account, and
              so you can watch the capability ladder negotiate a second, only partly compatible
              server. The sovereignty guard is still enforced — it has simply been handed a
              loopback-only policy. Set <code>RELAX_UI_PROVIDER=relaxai</code> for the real thing.
            </>
          )}
        </p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit({ topic, audience });
        }}
        style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem" }}
      >
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="What should the dashboard be about?"
          style={{ flex: "1 1 22rem", padding: "0.6rem 0.75rem", borderRadius: 8, border: "1px solid var(--border)" }}
        />
        <select
          value={audience}
          onChange={(event) => setAudience(event.target.value as typeof audience)}
          style={{ padding: "0.6rem 0.75rem", borderRadius: 8, border: "1px solid var(--border)" }}
        >
          <option value="executive">Executive</option>
          <option value="engineering">Engineering</option>
          <option value="finance">Finance</option>
        </select>
        <button type="submit" disabled={isStreaming} style={button}>
          {isStreaming ? "Generating…" : "Generate"}
        </button>
        {isStreaming ? (
          <button type="button" onClick={stop} style={{ ...button, background: "transparent", color: "inherit" }}>
            Stop
          </button>
        ) : null}
      </form>

      {error ? (
        <div role="alert" style={{ padding: "0.9rem 1rem", borderRadius: 10, border: "1px solid #c53030" }}>
          <strong>{error.code}</strong> — {error.message}
          {error.retryable ? " (retrying may help)" : null}
          {/*
            Which field broke, when the server knew. The SDK redacts these to a
            path and an issue code before they leave the server, so nothing here
            can carry model output — but the path alone is the difference
            between "the model got it wrong" and knowing where to look.
          */}
          {violations(error.details).length > 0 ? (
            <ul style={{ margin: "0.6rem 0 0", paddingLeft: "1.1rem" }}>
              {violations(error.details).map((issue) => (
                <li key={`${issue.path}:${issue.code}`}>
                  <code>{issue.path === "" ? "(root)" : issue.path}</code> — {issue.code}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/*
        `object.root` is partial for most of the stream: children arrive one at a
        time and props fill in mid-word. The renderer handles that because the
        schema's optional/required rules are enforced only at completion.
      */}
      <Dashboard node={object?.root} />

      {/*
        `strategy` arrives with the opening `meta` frame; `metadata` only with the
        terminal `complete` frame. Rendering the first without the second used to
        read as a finished generation when in fact the stream was still open or
        had failed — so the state is now named explicitly.
      */}
      {strategy ? (
        <footer style={{ marginTop: "2rem", fontSize: "0.8rem", color: "var(--muted)" }}>
          {error ? (
            <>
              Failed after negotiating <code>{strategy}</code> — <code>{error.code}</code>. No
              validated document was produced.
            </>
          ) : isStreaming ? (
            <>
              Streaming via <code>{strategy}</code>…
            </>
          ) : metadata ? (
            <>
              Structured via <code>{strategy}</code> on <code>{metadata.model}</code> in{" "}
              {Math.round(metadata.durationMs)}ms
              {metadata.downgradedFrom.length > 0
                ? ` (downgraded from ${metadata.downgradedFrom.join(", ")})`
                : null}
              {metadata.repairAttempts > 0
                ? `, ${metadata.repairAttempts} repair round${metadata.repairAttempts === 1 ? "" : "s"}`
                : null}
            </>
          ) : (
            <>
              Negotiated <code>{strategy}</code>, but the stream ended without a validated
              document. Check the server log for the reason.
            </>
          )}
        </footer>
      ) : null}

    </main>
  );
}

const button: React.CSSProperties = {
  padding: "0.6rem 1.1rem",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--accent)",
  color: "#fff",
  cursor: "pointer",
};


/**
 * Reads the redacted schema issues off an error, defensively.
 *
 * `details` is typed as arbitrary JSON because the protocol carries it verbatim
 * from the server, so the shape is checked here rather than asserted — an
 * endpoint that is not the one this page expects should render nothing, not
 * throw inside an error handler.
 */
function violations(details: unknown): { path: string; code: string }[] {
  if (!Array.isArray(details)) return [];
  return details.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { path, code } = entry as { path?: unknown; code?: unknown };
    if (typeof path !== "string" || typeof code !== "string") return [];
    return [{ path, code }];
  });
}
