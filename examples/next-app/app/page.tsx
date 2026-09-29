"use client";

import { useGenerativeObject } from "@civo/relax-ui-react";
import { useState } from "react";
import { Dashboard } from "./components";
import type { UINode } from "@civo/relax-ui-core";

/**
 * The entire client side of the feature.
 *
 * `useGenerativeObject` holds no API key, speaks to no model, and parses no
 * model output — it consumes the validated event stream from `/api/ui`. The
 * object it exposes is partial while streaming and complete afterwards, so the
 * renderer can paint every frame without special-casing "not finished yet".
 */
export default function Page() {
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
        </div>
      ) : null}

      {/*
        `object.root` is partial for most of the stream: children arrive one at a
        time and props fill in mid-word. The renderer handles that because the
        schema's optional/required rules are enforced only at completion.
      */}
      <Dashboard node={object?.root} />

      {strategy ? (
        <footer style={{ marginTop: "2rem", fontSize: "0.8rem", color: "var(--muted)" }}>
          Structured via <code>{strategy}</code>
          {metadata ? (
            <>
              {" "}
              on <code>{metadata.model}</code> in {Math.round(metadata.durationMs)}ms
              {metadata.downgradedFrom.length > 0
                ? ` (downgraded from ${metadata.downgradedFrom.join(", ")})`
                : null}
              {metadata.repairAttempts > 0 ? `, ${metadata.repairAttempts} repair round` : null}
            </>
          ) : null}
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
