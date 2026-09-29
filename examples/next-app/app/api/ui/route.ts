import { RelaxClient } from "@civo/relax-ui-core";
import { createGenerativeUIRoute } from "@civo/relax-ui-next";
import { z } from "zod";
import { dashboardSchema } from "../../ui-registry";

/**
 * The entire server side of the feature.
 *
 * Runs on the Edge runtime: the SDK's core touches nothing beyond `fetch`,
 * `ReadableStream` and `AbortController`, so there is no Node dependency to
 * strand it on a serverless function.
 */
export const runtime = "edge";

/**
 * One client per module, not one per request.
 *
 * Constructing it here means the API key is read once at cold start, lives only
 * in the server bundle, and cannot be reached from the browser. The sovereignty
 * check runs at construction, so a misconfigured `RELAX_BASE_URL` fails the
 * deploy rather than silently exfiltrating prompts to whatever host was typed.
 */
const client = new RelaxClient({
  // Redaction is opt-in; a dashboard prompt should never contain a card number,
  // and if one turns up we would like to know rather than forward it.
  redaction: true,
  onRedaction: (hits) => console.warn("[relax-ui] redacted outbound prompt", hits),
});

const InputSchema = z.object({
  topic: z.string().min(3).max(300),
  audience: z.enum(["executive", "engineering", "finance"]).default("executive"),
});

export const POST = createGenerativeUIRoute({
  client,
  // Llama 4 Maverick: 500k context, strong tool calling, cheap. The SDK will
  // negotiate down from json_schema to tool calling automatically.
  model: process.env["RELAX_MODEL"] ?? "Llama-4-Maverick-17B-128E",
  schema: dashboardSchema,
  inputSchema: InputSchema,

  system: [
    "You design compact analytics dashboards.",
    "Return one UI document built only from the components in the schema.",
    "Prefer a Stack root containing a Grid of 3-4 Metrics, then at most one Callout,",
    "then a BarList if there is ranked data worth showing.",
    "Never invent a figure you cannot justify from the request; say so in a Prose node instead.",
  ].join(" "),

  // The application owns prompt assembly. The browser supplies data, never
  // instructions: `topic` is interpolated as content, and `audience` only ever
  // selects between strings this file wrote.
  toMessages: (input) => [
    {
      role: "user",
      content:
        `Build a dashboard about: ${input.topic}\n\n` +
        `Audience: ${AUDIENCE_GUIDANCE[input.audience]}`,
    },
  ],

  sampling: { temperature: 0.4, max_tokens: 2_000 },

  // ~50ms between frames: fast enough to feel live, slow enough that a dense
  // tree is not re-laid-out on every token.
  frameIntervalMs: 50,

  onEvent: (event) => {
    if (event.type === "strategy_downgraded") {
      console.info(`[relax-ui] ${event.from} -> ${event.to}: ${event.reason}`);
    }
  },
});

const AUDIENCE_GUIDANCE: Record<"executive" | "engineering" | "finance", string> = {
  executive: "senior leadership — headline numbers, one clear takeaway, no jargon",
  engineering: "engineers — throughput, latency and reliability framing",
  finance: "finance — currency figures, margins and period-on-period movement",
};
