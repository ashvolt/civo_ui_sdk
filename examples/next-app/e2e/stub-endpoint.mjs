/**
 * An OpenAI-compatible endpoint that stands in for a local model.
 *
 * Two jobs. It lets the browser-level test drive the whole pipeline
 * deterministically — a real model gives a different document every run, which
 * is the wrong thing to assert on — and it lets anyone run the reference app
 * with no model and no account at all:
 *
 *   node e2e/stub-endpoint.mjs 11437
 *   RELAX_UI_PROVIDER=ollama OLLAMA_BASE_URL=http://127.0.0.1:11437/v1 pnpm dev
 *
 * It is deliberately awkward in the ways real endpoints are. `MODE` selects
 * which awkwardness:
 *
 *   ok        a valid document, streamed in small pieces (the default)
 *   truncate  stops mid-document with finish_reason "length"
 *   badtype   a Metric whose `value` is a number where the registry wants a string
 *
 * Every mode refuses `response_format: json_schema`, because Ollama does, so a
 * run always exercises a real downgrade from the top of the ladder to tool
 * calling rather than asserting the happy tier only.
 */
import { createServer } from "node:http";

const MODE = process.env["MODE"] ?? "ok";
const PORT = Number(process.argv[2] ?? process.env["PORT"] ?? 11437);

/** Satisfies the Dashboard registry: a Stack of Metrics plus a Prose note. */
const VALID = {
  root: {
    type: "Stack",
    props: { gap: "md", heading: "UK public cloud spend" },
    children: [
      { type: "Metric", key: "m1", props: { label: "Total spend", value: "£4.1bn", trend: "up" } },
      { type: "Metric", key: "m2", props: { label: "YoY growth", value: "18%", trend: "up" } },
      { type: "Prose", key: "p1", props: { text: "Figures illustrative — served by a local stand-in." } },
    ],
  },
};

/** `value` is a number. Valid JSON, invalid Dashboard: the fail-fast case. */
const BAD_TYPE = {
  root: {
    type: "Stack",
    props: { gap: "md", heading: "UK public cloud spend" },
    children: [{ type: "Metric", key: "m1", props: { label: "Total spend", value: 4_100_000_000, trend: "up" } }],
  },
};

const MODES = new Set(["ok", "truncate", "badtype"]);

/**
 * Mutable so one process can serve every case.
 *
 * The alternative is a stub process per mode, and with Playwright starting the
 * app once against one endpoint that would mean three app builds to test three
 * failure shapes. Switched over `POST /__mode`, which exists only for the test.
 */
let mode = MODES.has(MODE) ? MODE : "ok";

/** The body this mode answers with, and the finish_reason that goes with it. */
function payload() {
  const doc = JSON.stringify(mode === "badtype" ? BAD_TYPE : VALID);
  if (mode !== "truncate") return { body: doc, finish: "stop" };
  // 55% lands inside a string value, which is the hardest place to cut: the
  // partial parser has to keep it and the schema has to call it "not written
  // yet" rather than wrong.
  return { body: doc.slice(0, Math.floor(doc.length * 0.55)), finish: "length" };
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });

const sendJson = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
};

const chunk = (model, delta, finishReason) =>
  `data: ${JSON.stringify({
    id: "chunk",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [{ index: 0, finish_reason: finishReason, delta }],
  })}\n\n`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  // Test-only: switch which awkwardness this endpoint exhibits, so one process
  // and one app build cover every failure shape. Not part of any real API.
  if (url.pathname === "/__mode") {
    const requested = url.searchParams.get("mode") ?? "";
    if (!MODES.has(requested)) {
      return sendJson(res, 400, { error: { message: `unknown mode "${requested}"` } });
    }
    mode = requested;
    return sendJson(res, 200, { mode });
  }

  // One model, tool-capable and not a reasoning family, so the demo's own
  // ranking has nothing to weigh and the test asserts on a fixed name.
  if (url.pathname === "/v1/models") {
    return sendJson(res, 200, { object: "list", data: [{ id: "qwen2.5:7b", object: "model" }] });
  }
  if (url.pathname !== "/v1/chat/completions") {
    return sendJson(res, 404, { error: { message: `no route for ${url.pathname}` } });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: { message: "malformed request body" } });
  }

  // The capability rejection the ladder exists to absorb. Phrased the way
  // Ollama phrases it so the SDK's classifier is genuinely exercised.
  if (body.response_format?.type === "json_schema") {
    return sendJson(res, 400, {
      error: { message: "response_format json_schema is not supported by this model" },
    });
  }

  const model = body.model ?? "unknown";
  const asToolCall = Array.isArray(body.tools) && body.tools.length > 0;
  const wrap = (text) =>
    asToolCall
      ? { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "Dashboard", arguments: text } }] }
      : { content: text };

  const { body: text, finish } = payload();

  if (!body.stream) {
    return sendJson(res, 200, {
      id: "completion",
      object: "chat.completion",
      created: 0,
      model,
      choices: [
        {
          index: 0,
          finish_reason: finish,
          message: { role: "assistant", content: null, ...wrap(text) },
        },
      ],
    });
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  // Small pieces on purpose: the point is to make the browser render a document
  // that is still half-written, which is what the partial parser is for.
  const size = 24;
  for (let at = 0; at < text.length; at += size) {
    const isLast = at + size >= text.length;
    res.write(chunk(model, wrap(text.slice(at, at + size)), isLast ? finish : null));
  }
  res.write("data: [DONE]\n\n");
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  // stderr, so a parent process reading stdout for data is unaffected.
  console.error(`stub endpoint (mode=${mode}) on http://127.0.0.1:${PORT}/v1`);
});
