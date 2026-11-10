/**
 * A static server for the example, with the policy the page must work under:
 * `script-src 'self'` — no `unsafe-eval`, no `unsafe-inline` — and the same for
 * styles (T-248). Also a stand-in for the SDK's route: POST /api/ui answers
 * with the SDK's SSE frames for a fixed document, a few characters at a time,
 * as a model would write it.
 *
 *   node serve.mjs [port]
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatch, diffJson, encodeUIStreamEvent, parsePartialJson } from "relax-ui-core";
import { DOCUMENT } from "./document.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "public");
const port = Number(process.argv[2] ?? process.env.PORT ?? 3300);

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  // Bootstrap's form and close icons are data: SVGs.
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".map": "application/json", ".svg": "image/svg+xml" };

/**
 * The frames a server sends for DOCUMENT: meta, patches, complete. `label`
 * names the card's region, so two elements showing the document on one page
 * do not present two landmarks with the same name.
 */
function events(label) {
  const doc = withLabel(label);
  const text = JSON.stringify(doc);
  const out = [{ type: "meta", protocol: 1, requestId: "req_local", model: "stand-in", provider: "local", strategy: "json_schema", schema: {} }];
  let current;
  let seq = 0;
  for (let end = 24; end < text.length + 24; end += 24) {
    const parsed = parsePartialJson(text.slice(0, Math.min(end, text.length)));
    if (parsed.value === undefined) continue;
    const ops = diffJson(current, parsed.value);
    if (ops.length === 0) continue;
    current = applyPatch(current, ops);
    out.push({ type: "patch", seq: ++seq, ops });
  }
  out.push({
    type: "complete",
    value: doc,
    metadata: { requestId: "req_local", model: "stand-in", provider: "local", strategy: "json_schema", downgradedFrom: [], repairAttempts: 0, latencyMs: 0 },
  });
  return out;
}

export function withLabel(label) {
  if (typeof label !== "string" || label === "") return DOCUMENT;
  const copy = structuredClone(DOCUMENT);
  const card = copy.root.children.find((c) => c.type === "Card");
  card.props.title = `${card.props.title} · ${label.slice(0, 40)}`;
  return copy;
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) break;
  }
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (url.pathname === "/api/ui" && req.method === "POST") {
    const { label } = await readJson(req);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    for (const event of events(label)) {
      res.write(encodeUIStreamEvent(event));
      await new Promise((r) => setTimeout(r, 15));
    }
    res.end("data: [DONE]\n\n");
    return;
  }

  const path = normalize(join(root, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(res);
});

server.listen(port, "127.0.0.1", () => console.log(`html-host on http://127.0.0.1:${port}`));
