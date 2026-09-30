/**
 * A stub that behaves like three different relaxAI models, so probe-models.ts
 * can be verified end to end without a live key:
 *
 *   stub-full     supports json_schema, tools, json_object, streaming
 *   stub-tools    rejects json_schema (400), supports tools; emits <think>
 *   stub-floor    rejects json_schema and tools; only json_object
 *   stub-embed    embeddings-only, so the probe must skip it
 */
import { createServer } from "node:http";

const PAYLOAD = JSON.stringify({ ok: true, colour: "green" });

const MODELS = ["stub-full", "stub-tools", "stub-floor", "stub-embed-1b"];

const read = (req) =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
  });

const json = (res, status, obj) => {
  const text = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
};

const err = (res, status, message) => json(res, status, { error: { message, type: "invalid_request_error" } });

const completion = (model, content, toolArgs) => ({
  id: "cmpl_stub",
  object: "chat.completion",
  created: 0,
  model,
  choices: [
    {
      index: 0,
      finish_reason: toolArgs ? "tool_calls" : "stop",
      message: toolArgs
        ? { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Probe", arguments: toolArgs } }] }
        : { role: "assistant", content },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/v1/models" && req.method === "GET") {
    return json(res, 200, { object: "list", data: MODELS.map((id) => ({ id, object: "model", owned_by: "stub" })) });
  }

  if (url.pathname !== "/v1/chat/completions") return err(res, 404, "not found");

  const body = await read(req);
  const model = body.model ?? "";
  const wantsSchema = body.response_format?.type === "json_schema";
  const wantsTools = Array.isArray(body.tools) && body.tools.length > 0;

  if (model.includes("embed")) return err(res, 400, "this model does not support chat completions");

  if (wantsSchema && model !== "stub-full") {
    return err(res, 400, "response_format json_schema is not supported by this model");
  }
  if (wantsTools && model === "stub-floor") {
    return err(res, 400, "tools are not supported by this model");
  }

  if (body.stream) {
    // stub-floor also cannot stream, so the probe has something to report.
    if (model === "stub-floor") return err(res, 400, "streaming is not available for this model");
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    for (const piece of ["hi", " there"]) {
      res.write(`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, finish_reason: null, delta: { content: piece } }] })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    return res.end();
  }

  if (wantsTools) return json(res, 200, completion(model, null, PAYLOAD));

  // stub-tools wraps its answer in a reasoning block and a fenced code block,
  // which is what the extraction funnel exists for.
  const content =
    model === "stub-tools"
      ? `<think>The user wants the probe payload.</think>\nHere you go:\n\`\`\`json\n${PAYLOAD}\n\`\`\``
      : PAYLOAD;
  return json(res, 200, completion(model, content));
});

const port = Number(process.argv[2] ?? 8099);
server.listen(port, "127.0.0.1", () => console.error(`stub relaxAI listening on http://127.0.0.1:${port}/v1`));
