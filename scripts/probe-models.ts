/**
 * Measure relaxAI's per-model capabilities instead of assuming them.
 *
 * `packages/core/src/capability/registry.ts` ships *priors* — assembled from
 * Civo's published documentation, each carrying a `note` saying so. They are
 * good enough that a wrong one costs a single wasted request per model per
 * process, because the floor strategy needs no server feature at all. They are
 * not good enough to publish as fact.
 *
 * This script replaces them with measurements. It asks each chat model in the
 * catalogue to do the three things the structuring ladder cares about, plus
 * streaming, and reports what actually happened.
 *
 * Requires a build first (`pnpm build`): it imports `relax-ui-core` by name, so
 * it exercises the published artifact rather than the sources.
 *
 * Usage:
 *   pnpm build
 *   RELAX_API_KEY=... pnpm probe
 *   pnpm probe -- --models Llama-4-Maverick-17B-128E,GLM-46
 *   pnpm probe -- --out capabilities.json
 *
 * It spends real tokens: four small completions per model, capped at 128 output
 * tokens each. Probing the whole catalogue costs pennies; `--models` narrows it.
 *
 * Note that it drives the SDK's own `RelaxClient` rather than raw fetch, so a
 * successful run also exercises the transport, the sovereignty guard and the
 * rejection classifier against the live API.
 */

import { z } from "zod";
import {
  defineStructuredSchema,
  extractJsonText,
  isCapabilityRejection,
  isRelaxUIError,
  parsePartialJson,
  RelaxClient,
  type ChatCompletionRequest,
  type ModelCapabilities,
  type ModelDescriptor,
} from "relax-ui-core";

// --- the probe payload ------------------------------------------------------

/**
 * Deliberately tiny. We are measuring whether the *mechanism* works, not
 * whether the model is clever, and a small schema keeps the token cost and the
 * false-failure rate down.
 */
const ProbeSchema = defineStructuredSchema({
  name: "Probe",
  description: "A trivial structured response used to test schema enforcement.",
  schema: z.object({
    ok: z.boolean().describe("Always true."),
    colour: z.enum(["red", "green", "blue"]).describe("Any one of the three."),
  }),
});

const PROMPT = 'Reply with {"ok":true,"colour":"green"} and nothing else.';
const MAX_TOKENS = 128;

// --- results ----------------------------------------------------------------

type ProbeOutcome = "supported" | "rejected" | "malformed" | "error" | "skipped";

interface ProbeResult {
  outcome: ProbeOutcome;
  detail?: string;
  /** Set when the server said this model does not serve /chat/completions. */
  nonChat?: true;
}

interface ModelReport {
  model: string;
  chatCapable: boolean;
  jsonSchema: ProbeResult;
  jsonObject: ProbeResult;
  toolCalling: ProbeResult;
  streaming: ProbeResult;
  reasoningTrace: boolean;
  /** What the priors claimed, so a difference is visible rather than implied. */
  prior: Pick<
    ModelCapabilities,
    "jsonSchema" | "jsonObject" | "toolCalling" | "streaming" | "reasoningTrace" | "chatCapable"
  >;
}

// --- CLI --------------------------------------------------------------------

interface Options {
  models?: string[];
  out?: string;
  allowInsecure: boolean;
  baseURL?: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { allowInsecure: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // `pnpm probe -- --flag` forwards a bare `--`; it is a separator, not a flag.
    if (arg === "--") continue;
    if (arg === "--models") options.models = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--base-url") options.baseURL = argv[++i];
    // Only for pointing the probe at a local stub. Never for a real endpoint.
    else if (arg === "--allow-insecure-loopback") options.allowInsecure = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "probe-models — measure relaxAI per-model capabilities",
          "",
          "  --models a,b     probe only these model ids",
          "  --base-url URL   override RELAX_BASE_URL",
          "  --out FILE       also write the capability seed as JSON",
          "  --allow-insecure-loopback   permit http:// on localhost (stub testing only)",
        ].join("\n"),
      );
      process.exit(0);
    } else if (arg?.startsWith("--")) {
      console.error(`Unknown flag: ${arg}. Try --help.`);
      process.exit(2);
    }
  }
  return options;
}

// --- probes -----------------------------------------------------------------

/**
 * Each probe answers one question and distinguishes four outcomes, because
 * "it didn't work" is not actionable:
 *
 *   supported — the mechanism worked and the payload validated
 *   rejected  — the server said it does not support this (a capability fact)
 *   malformed — the mechanism was accepted but the output did not validate
 *               (a quality signal, not a capability one)
 *   error     — something else went wrong; the run should not claim anything
 */
async function probe(
  client: RelaxClient,
  model: string,
  strategy: "native_json_schema" | "tool_call" | "prompted_json",
): Promise<{ result: ProbeResult; raw: string }> {
  const base: ChatCompletionRequest = {
    model,
    messages: [{ role: "user", content: PROMPT }],
    max_tokens: MAX_TOKENS,
    temperature: 0,
  };

  const request: ChatCompletionRequest =
    strategy === "native_json_schema"
      ? {
          ...base,
          response_format: {
            type: "json_schema",
            json_schema: { name: ProbeSchema.name, schema: ProbeSchema.jsonSchema, strict: true },
          },
        }
      : strategy === "tool_call"
        ? {
            ...base,
            tools: [
              {
                type: "function",
                function: {
                  name: ProbeSchema.name,
                  description: "Emit the probe payload.",
                  parameters: ProbeSchema.jsonSchema,
                  strict: true,
                },
              },
            ],
            tool_choice: { type: "function", function: { name: ProbeSchema.name } },
          }
        : { ...base, response_format: { type: "json_object" } };

  try {
    const response = await client.chatCompletion(request);
    const choice = response.choices?.[0];
    const raw =
      strategy === "tool_call"
        ? (choice?.message?.tool_calls?.[0]?.function.arguments ?? choice?.message?.content ?? "")
        : (choice?.message?.content ?? "");

    if (raw.trim() === "") {
      return { result: { outcome: "malformed", detail: "empty response" }, raw: "" };
    }

    // Reuse the SDK's own extraction and validation, so "supported" here means
    // the same thing it means at runtime.
    const text = extractJsonText(raw, { stripReasoning: true });
    const parsed = parsePartialJson(text);
    if (parsed.state !== "complete" && parsed.state !== "partial") {
      return { result: { outcome: "malformed", detail: "no parseable JSON" }, raw };
    }
    const check = ProbeSchema.schema.safeParse(parsed.value);
    return {
      result: check.success
        ? { outcome: "supported" }
        : { outcome: "malformed", detail: "parsed but failed the probe schema" },
      raw,
    };
  } catch (error) {
    if (isNonChatModel(error)) {
      return { result: { outcome: "error", detail: shortMessage(error), nonChat: true }, raw: "" };
    }
    if (isCapabilityRejection(error, strategy)) {
      return { result: { outcome: "rejected", detail: shortMessage(error) }, raw: "" };
    }
    return { result: { outcome: "error", detail: shortMessage(error) }, raw: "" };
  }
}

async function probeStreaming(client: RelaxClient, model: string): Promise<ProbeResult> {
  try {
    let chunks = 0;
    for await (const _chunk of client.streamChatCompletion({
      model,
      messages: [{ role: "user", content: "Say hi." }],
      max_tokens: 16,
      temperature: 0,
    })) {
      if (++chunks >= 2) break; // two chunks is proof enough; don't pay for the rest
    }
    return chunks > 0 ? { outcome: "supported" } : { outcome: "malformed", detail: "no chunks" };
  } catch (error) {
    // `isCapabilityRejection` only covers the two structuring strategies, so a
    // server saying "this model cannot stream" has to be classified here. It is
    // a capability fact, not an error, and recording it as the latter would
    // leave `streaming` unmeasured for exactly the models where it matters.
    if (isNonChatModel(error)) return { outcome: "error", detail: shortMessage(error), nonChat: true };
    if (isStreamingRejection(error)) return { outcome: "rejected", detail: shortMessage(error) };
    return { outcome: "error", detail: shortMessage(error) };
  }
}

function isStreamingRejection(error: unknown): boolean {
  if (!isRelaxUIError(error)) return false;
  if (![400, 404, 422, 501].includes(error.status ?? 0)) return false;
  const message = error.message.toLowerCase();
  if (isNonChatModel(error)) return false; // a different finding; see below
  return (
    message.includes("stream") ||
    message.includes("not supported") ||
    message.includes("unsupported") ||
    message.includes("not implemented")
  );
}

/**
 * True when the server is saying this model does not serve `/chat/completions`
 * at all — an embeddings or rerank model. Every probe will fail for the same
 * reason, and the honest record is `chatCapable: false`, not four errors and a
 * `chatCapable: true` inherited from the prior.
 */
function isNonChatModel(error: unknown): boolean {
  if (!isRelaxUIError(error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("not support chat") ||
    message.includes("not a chat model") ||
    message.includes("does not support chat completions") ||
    (message.includes("chat completion") && message.includes("not"))
  );
}

/** Reasoning wrappers are detectable from any raw completion. */
function looksLikeReasoning(raw: string): boolean {
  return /<think>|<thinking>|<reasoning>|<\|channel\|>/i.test(raw);
}

function shortMessage(error: unknown): string {
  const message = isRelaxUIError(error) ? error.message : error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 160);
}

// --- reporting --------------------------------------------------------------

const GLYPH: Record<ProbeOutcome, string> = {
  supported: "yes",
  rejected: "no",
  malformed: "flaky",
  error: "err",
  skipped: "—",
};

function markdownTable(reports: ModelReport[]): string {
  const rows = reports.map((r) => {
    const drift = driftOf(r);
    return `| \`${r.model}\` | ${GLYPH[r.jsonSchema.outcome]} | ${GLYPH[r.toolCalling.outcome]} | ${GLYPH[r.jsonObject.outcome]} | ${GLYPH[r.streaming.outcome]} | ${r.reasoningTrace ? "yes" : "no"} | ${drift.length ? drift.join(", ") : "—"} |`;
  });
  return [
    "| model | json_schema | tool_call | json_object | streaming | reasoning | differs from prior |",
    "|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

/** Where measurement disagrees with the shipped prior. The point of the script. */
function driftOf(r: ModelReport): string[] {
  const drift: string[] = [];
  const compare = (name: string, measured: ProbeOutcome, prior: boolean) => {
    if (measured === "error" || measured === "skipped") return;
    const observed = measured === "supported";
    if (observed !== prior) drift.push(`${name}: ${prior} → ${observed}`);
  };
  compare("jsonSchema", r.jsonSchema.outcome, r.prior.jsonSchema);
  compare("toolCalling", r.toolCalling.outcome, r.prior.toolCalling);
  compare("jsonObject", r.jsonObject.outcome, r.prior.jsonObject);
  compare("streaming", r.streaming.outcome, r.prior.streaming);
  if (r.chatCapable !== r.prior.chatCapable) {
    drift.push(`chatCapable: ${r.prior.chatCapable} → ${r.chatCapable}`);
  }
  if (r.chatCapable && r.reasoningTrace !== r.prior.reasoningTrace) {
    drift.push(`reasoningTrace: ${r.prior.reasoningTrace} → ${r.reasoningTrace}`);
  }
  return drift;
}

/** A paste-ready `CapabilityRegistry` seed. */
function registrySeed(reports: ModelReport[]): Record<string, Partial<ModelCapabilities>> {
  const seed: Record<string, Partial<ModelCapabilities>> = {};
  for (const r of reports) {
    // Only record what was actually observed. An `error` outcome must not be
    // written back as `false` — that would launder a network blip into a fact.
    const entry: Partial<ModelCapabilities> = { note: `Measured ${new Date().toISOString().slice(0, 10)}.` };
    entry.chatCapable = r.chatCapable;
    if (!r.chatCapable) {
      // Strategy flags are meaningless for a model that has no chat endpoint.
      seed[r.model] = entry;
      continue;
    }
    if (r.jsonSchema.outcome === "supported" || r.jsonSchema.outcome === "rejected") {
      entry.jsonSchema = r.jsonSchema.outcome === "supported";
    }
    if (r.toolCalling.outcome === "supported" || r.toolCalling.outcome === "rejected") {
      entry.toolCalling = r.toolCalling.outcome === "supported";
    }
    if (r.jsonObject.outcome === "supported" || r.jsonObject.outcome === "rejected") {
      entry.jsonObject = r.jsonObject.outcome === "supported";
    }
    if (r.streaming.outcome !== "error" && r.streaming.outcome !== "skipped") {
      entry.streaming = r.streaming.outcome === "supported";
    }
    entry.reasoningTrace = r.reasoningTrace;
    seed[r.model] = entry;
  }
  return seed;
}

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const client = new RelaxClient({
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(options.allowInsecure ? { sovereignty: { allowInsecureTransport: true } } : {}),
    // A probe that retries hides the very flakiness it is trying to measure.
    retry: { maxRetries: 0 },
    timeoutMs: 60_000,
  });

  console.log(`Probing ${client.baseURL.host}\n`);

  let catalogue: ModelDescriptor[];
  try {
    catalogue = await client.listModels();
  } catch (error) {
    console.error(`Could not list models: ${shortMessage(error)}`);
    process.exit(1);
  }

  let ids = catalogue.map((m) => m.id).filter(Boolean);
  if (options.models?.length) {
    const wanted = new Set(options.models.map((m) => m.toLowerCase()));
    const missing = options.models.filter((m) => !ids.some((id) => id.toLowerCase() === m.toLowerCase()));
    if (missing.length) console.warn(`Not in the catalogue, skipping: ${missing.join(", ")}\n`);
    ids = ids.filter((id) => wanted.has(id.toLowerCase()));
  }

  if (ids.length === 0) {
    console.error("No models to probe.");
    process.exit(1);
  }

  const reports: ModelReport[] = [];

  for (const model of ids) {
    const prior = client.capabilitiesFor(model);
    process.stdout.write(`${model} … `);

    if (!prior.chatCapable) {
      // An embeddings model on /chat/completions is a known error, not a finding.
      reports.push({
        model,
        chatCapable: false,
        jsonSchema: { outcome: "skipped" },
        jsonObject: { outcome: "skipped" },
        toolCalling: { outcome: "skipped" },
        streaming: { outcome: "skipped" },
        reasoningTrace: false,
        prior,
      });
      console.log("skipped (not a chat model)");
      continue;
    }

    // Sequential on purpose: four concurrent requests per model across a whole
    // catalogue is a good way to measure the rate limiter instead.
    const schemaProbe = await probe(client, model, "native_json_schema");
    const toolProbe = await probe(client, model, "tool_call");
    const promptProbe = await probe(client, model, "prompted_json");
    const streaming = await probeStreaming(client, model);

    const reasoningTrace = [schemaProbe.raw, toolProbe.raw, promptProbe.raw].some(looksLikeReasoning);

    // The prior said this was a chat model. If every probe came back "this model
    // does not serve chat completions", the prior was wrong and the measurement
    // says so — rather than inheriting `true` and recording four errors.
    const probes = [schemaProbe.result, toolProbe.result, promptProbe.result, streaming];
    const chatCapable = !probes.some((p) => p.nonChat === true);

    reports.push({
      model,
      chatCapable,
      jsonSchema: schemaProbe.result,
      toolCalling: toolProbe.result,
      jsonObject: promptProbe.result,
      streaming,
      reasoningTrace,
      prior,
    });

    if (!chatCapable) {
      console.log("not a chat model (the prior was wrong)");
      continue;
    }

    console.log(
      `json_schema=${GLYPH[schemaProbe.result.outcome]} tool=${GLYPH[toolProbe.result.outcome]} ` +
        `json_object=${GLYPH[promptProbe.result.outcome]} stream=${GLYPH[streaming.outcome]}`,
    );
  }

  const drifted = reports.filter((r) => driftOf(r).length > 0);

  console.log(`\n## Measured capabilities\n\n${markdownTable(reports)}\n`);

  console.log("## Capability registry seed\n");
  console.log("```ts");
  console.log("new CapabilityRegistry(");
  console.log(`${JSON.stringify(registrySeed(reports), null, 2)},`);
  console.log(")");
  console.log("```\n");

  if (drifted.length === 0) {
    console.log("Every measurement agreed with the shipped prior.");
  } else {
    console.log(`${drifted.length} of ${reports.length} models differ from the shipped prior:`);
    for (const r of drifted) console.log(`  ${r.model}: ${driftOf(r).join(", ")}`);
    console.log("\nUpdate packages/core/src/capability/registry.ts with the seed above.");
  }

  const errored = reports.filter(
    (r) =>
      r.chatCapable &&
      [r.jsonSchema, r.toolCalling, r.jsonObject, r.streaming].some((p) => p.outcome === "error"),
  );
  if (errored.length) {
    console.log(`\n${errored.length} model(s) hit errors; those flags were left unrecorded:`);
    for (const r of errored) {
      for (const [name, p] of Object.entries({
        json_schema: r.jsonSchema,
        tool_call: r.toolCalling,
        json_object: r.jsonObject,
        streaming: r.streaming,
      })) {
        if (p.outcome === "error") console.log(`  ${r.model} ${name}: ${p.detail}`);
      }
    }
  }

  if (options.out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(options.out, `${JSON.stringify(registrySeed(reports), null, 2)}\n`);
    console.log(`\nWrote ${options.out}`);
  }
}

await main();
