import { createGenerativeUIRoute } from "relax-ui-next";
import { z } from "zod";
import { getProvider } from "../../provider";
import { dashboardSchema } from "../../ui-registry";

/**
 * The entire server side of the feature.
 *
 * Node rather than Edge, only because a local provider has to reach a runtime
 * on 127.0.0.1 — an Edge deployment has no loopback to reach. Against relaxAI
 * this route runs unchanged on the Edge runtime (`export const runtime =
 * "edge"`), and did until the local provider was added; the SDK's core needs
 * nothing beyond `fetch`, `ReadableStream` and `AbortController`.
 */
export const runtime = "nodejs";

/**
 * One provider per module, not per request.
 *
 * Built at cold start, so the API key is read once and lives only in the server
 * bundle. The sovereignty check runs inside the client constructor, which means
 * a misconfigured endpoint fails the first request loudly rather than quietly
 * sending prompts somewhere unintended.
 */
const provider = getProvider();

const InputSchema = z.object({
  topic: z.string().min(3).max(300),
  audience: z.enum(["executive", "engineering", "finance"]).default("executive"),
});

export const POST = createGenerativeUIRoute({
  client: provider.client,
  // A string against relaxAI; against a local runtime, a resolver that asks the
  // endpoint what it actually has installed. Either way the *application*
  // decides — the browser cannot influence it.
  model: provider.model,
  schema: dashboardSchema,
  inputSchema: InputSchema,

  system: [
    "You design compact analytics dashboards.",
    "Return one UI document built only from the components in the schema.",
    "Prefer a Stack root containing a Grid of 3-4 Metrics, then at most one Callout,",
    "then a BarList if there is ranked data worth showing.",
    // Stated as a rule about form, with no sample figure: a small model that can
    // see an example copies it, and one that cannot see the schema's
    // descriptions (a grammar-constrained tier) otherwise guesses what `value`
    // is for and sometimes writes a sentence there.
    "A Metric's value is only the figure itself with its unit, never a sentence;",
    "what the figure means goes in the label, and any comparison in the caption.",
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

  sampling: provider.sampling,
  frameIntervalMs: provider.frameIntervalMs,

  onEvent: (event) => {
    if (event.type === "strategy_downgraded") {
      console.info(`[relax-ui] ${event.from} -> ${event.to}: ${event.reason}`);
    }
    // The endpoint's constrained decoder was sent a narrower schema than the
    // one that validates. Worth a line: it is the SDK telling the model less
    // than it enforces, and that should never happen unobserved.
    if (event.type === "schema_adapted") {
      console.info(`[relax-ui] wire schema for ${event.provider} omits: ${event.dropped.join(", ")}`);
    }
  },
});

const AUDIENCE_GUIDANCE: Record<"executive" | "engineering" | "finance", string> = {
  executive: "senior leadership — headline numbers, one clear takeaway, no jargon",
  engineering: "engineers — throughput, latency and reliability framing",
  finance: "finance — currency figures, margins and period-on-period movement",
};
