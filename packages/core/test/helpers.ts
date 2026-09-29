import type { FetchLike } from "../src/client/http.js";
import { RelaxClient } from "../src/client/relax-client.js";
import { CapabilityRegistry } from "../src/capability/registry.js";
import type { ChatCompletionRequest } from "../src/types.js";

export interface RecordedRequest {
  url: string;
  method: string;
  body: ChatCompletionRequest;
  headers: Record<string, string>;
}

export interface StubResponse {
  status?: number;
  json?: unknown;
  /** SSE `data:` payloads, sent in order, followed by `[DONE]`. */
  sse?: unknown[];
  headers?: Record<string, string>;
}

export interface Stub {
  fetch: FetchLike;
  requests: RecordedRequest[];
}

/** A `fetch` that replays scripted responses and records what it was sent. */
export function stubFetch(responses: StubResponse[]): Stub {
  const requests: RecordedRequest[] = [];
  let index = 0;

  const fetchImpl: FetchLike = async (url, init) => {
    const body = init.body ? (JSON.parse(String(init.body)) as ChatCompletionRequest) : ({} as ChatCompletionRequest);
    requests.push({
      url,
      method: init.method ?? "GET",
      body,
      headers: (init.headers ?? {}) as Record<string, string>,
    });

    const spec = responses[Math.min(index, responses.length - 1)];
    index++;
    if (!spec) throw new Error("stubFetch ran out of scripted responses");

    const status = spec.status ?? 200;

    if (spec.sse) {
      const encoder = new TextEncoder();
      const frames = [...spec.sse.map((f) => `data: ${JSON.stringify(f)}\n\n`), "data: [DONE]\n\n"];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const frame of frames) controller.enqueue(encoder.encode(frame));
          controller.close();
        },
      });
      return new Response(stream, {
        status,
        headers: { "content-type": "text/event-stream", ...spec.headers },
      });
    }

    return new Response(JSON.stringify(spec.json ?? {}), {
      status,
      headers: { "content-type": "application/json", ...spec.headers },
    });
  };

  return { fetch: fetchImpl, requests };
}

export function testClient(stub: Stub, capabilities?: CapabilityRegistry): RelaxClient {
  return new RelaxClient({
    apiKey: "test-key",
    fetch: stub.fetch,
    capabilities: capabilities ?? new CapabilityRegistry(),
    retry: { maxRetries: 0, sleep: async () => undefined },
  });
}

/** A non-streaming chat completion whose assistant content is `content`. */
export function completion(content: string): unknown {
  return {
    id: "cmpl_1",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

/** A non-streaming completion that answers with a tool call. */
export function toolCompletion(name: string, args: string): unknown {
  return {
    id: "cmpl_1",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: args } }],
        },
      },
    ],
  };
}

/** Splits `text` into streaming content deltas of `size` characters. */
export function contentChunks(text: string, size = 8): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push({
      id: "cmpl_1",
      object: "chat.completion.chunk",
      created: 0,
      model: "test-model",
      choices: [{ index: 0, finish_reason: null, delta: { content: text.slice(i, i + size) } }],
    });
  }
  return out;
}

/** Splits `text` into streaming tool-call argument deltas. */
export function toolChunks(name: string, text: string, size = 8): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push({
      id: "cmpl_1",
      object: "chat.completion.chunk",
      created: 0,
      model: "test-model",
      choices: [
        {
          index: 0,
          finish_reason: null,
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name, arguments: text.slice(i, i + size) } },
            ],
          },
        },
      ],
    });
  }
  return out;
}

export function errorBody(message: string): unknown {
  return { error: { message, type: "invalid_request_error" } };
}
