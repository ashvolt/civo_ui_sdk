/**
 * The examples' server: static files under the policy a strict site serves,
 * and a stand-in for the SDK's route.
 *
 * - Every response carries a Content-Security-Policy with `script-src 'self'`:
 *   no `unsafe-eval`, no `unsafe-inline` (T-248, T-255).
 * - Styles are `'self'` too. A host whose framework injects component styles
 *   at runtime (Angular) gets a fresh nonce per page instead of
 *   `unsafe-inline`: `__CSP_NONCE__` in an HTML file is replaced with it.
 * - `POST /api/ui` streams the SDK's SSE frames for a fixed document, a few
 *   characters at a time, as a model would write it. `{ "label": "x" }` names
 *   the document's card, so several elements on one page have distinct
 *   landmarks.
 */
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { applyPatch, diffJson, encodeUIStreamEvent, parsePartialJson } from "relax-ui-core";
import { DOCUMENT, withLabel } from "./document.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

export function csp({ nonce } = {}) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    `style-src 'self'${nonce ? ` 'nonce-${nonce}'` : ""}`,
    "connect-src 'self'",
    // Bootstrap's icons are data: SVGs.
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    // Angular's <base href="/">; a base on this origin only.
    "base-uri 'self'",
  ].join("; ");
}

/** The frames a server sends for the document: meta, patches, complete. */
export function events(label) {
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

/**
 * @param {{ root: string, port: number, name: string, nonce?: boolean, index?: string }} options
 *   `nonce`: give each HTML page a style nonce. `index`: the file for `/`
 *   and for any unknown path without an extension (a single-page app).
 */
export function serve({ root, port, name, nonce = false, index = "index.html" }) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (url.pathname === "/api/ui" && req.method === "POST") {
      const { label } = await readJson(req);
      res.setHeader("Content-Security-Policy", csp());
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      for (const event of events(label)) {
        res.write(encodeUIStreamEvent(event));
        await new Promise((r) => setTimeout(r, 15));
      }
      res.end("data: [DONE]\n\n");
      return;
    }

    let path = normalize(join(base, url.pathname === "/" ? index : decodeURIComponent(url.pathname)));
    if (!existsSync(path) && extname(path) === "") path = join(base, index);
    if (!path.startsWith(base) || !existsSync(path) || !statSync(path).isFile()) {
      res.setHeader("Content-Security-Policy", csp());
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    const type = TYPES[extname(path)] ?? "application/octet-stream";
    if (type.startsWith("text/html")) {
      const value = nonce ? randomBytes(16).toString("base64") : undefined;
      const html = readFileSync(path, "utf8").replaceAll("__CSP_NONCE__", value ?? "");
      res.setHeader("Content-Security-Policy", csp({ nonce: value }));
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }).end(html);
      return;
    }
    res.setHeader("Content-Security-Policy", csp());
    res.writeHead(200, { "Content-Type": type });
    createReadStream(path).pipe(res);
  });
  server.listen(port, "127.0.0.1", () => console.log(`${name} on http://127.0.0.1:${port}`));
  return server;
}

export { DOCUMENT };
