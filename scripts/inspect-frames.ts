/**
 * Watch the UI stream being built, frame by frame, against a real model.
 *
 * The unit tests prove the frame pipeline against scripted chunks. What they
 * cannot show is what a *real* open-weight model does to it: how it splits a
 * tool call across deltas, whether it thinks first, whether it spells an enum
 * one character at a time. This script runs one generation, prints every frame
 * as it is created, and then checks the invariants the wire contract promises
 * (specs/001-generative-ui-sdk/contracts/ui-stream-protocol.md):
 *
 *   1. exactly one `meta` frame, and it is first
 *   2. `seq` starts at 1 and increases by exactly 1
 *   3. exactly one terminal frame (`complete` or `error`), and it is last
 *   4. replaying the frames through `UIStreamAccumulator` reproduces the
 *      completed value byte for byte
 *   5. every intermediate document is tolerated by the schema under streaming
 *      rules — nothing the browser was sent would have been refused
 *
 * It needs no relaxAI account: the default target is a local Ollama.
 *
 * Usage (after `pnpm build`):
 *   pnpm frames                                  # local Ollama, auto-picked model
 *   pnpm frames -- --model qwen2.5:7b
 *   pnpm frames -- --provider lmstudio --model <id>
 *   pnpm frames -- --provider relaxai --model Llama-4-Maverick-17B-128E
 *   pnpm frames -- --json frames.json            # also write the frames to a file
 *
 * Exit code is 0 when the stream completed and every invariant held, 1 otherwise.
 */

import { writeFileSync } from "node:fs";
import {
  createClient,
  pickChatModel,
  safeParsePartial,
  streamObject,
  UIStreamAccumulator,
  type JsonValue,
  type StructuringStrategyName,
  type UIStreamEvent,
} from "relax-ui-core";
import { dashboardSchema } from "../examples/next-app/app/ui-registry.ts";

interface Args {
  provider: string;
  model?: string;
  baseURL?: string;
  topic: string;
  json?: string;
  force?: StructuringStrategyName;
  maxTokens: number;
  interval: number;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    provider: process.env["RELAX_UI_PROVIDER"] ?? "ollama",
    topic: "UK public cloud spend, 2024 vs 2025",
    maxTokens: 1500,
    interval: 0,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    if (flag === "--") continue;
    else if (flag === "--provider") args.provider = next();
    else if (flag === "--model") args.model = next();
    else if (flag === "--base-url") args.baseURL = next();
    else if (flag === "--topic") args.topic = next();
    else if (flag === "--json") args.json = next();
    else if (flag === "--force") args.force = next() as StructuringStrategyName;
    else if (flag === "--max-tokens") args.maxTokens = Number(next());
    else if (flag === "--interval") args.interval = Number(next());
    else if (flag === "--quiet") args.quiet = true;
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

function summarise(event: UIStreamEvent<unknown>): string {
  switch (event.type) {
    case "meta":
      return `meta      model=${event.model} strategy=${event.strategy} provider=${event.provider ?? "?"}`;
    case "patch":
      return `patch     seq=${event.seq} ops=${event.ops.length} ${preview(event.ops)}`;
    case "snapshot":
      return `snapshot  seq=${event.seq} ${preview(event.value)}`;
    case "complete":
      return (
        `complete  strategy=${event.metadata.strategy} ` +
        `downgradedFrom=[${event.metadata.downgradedFrom.join(",")}] ` +
        `repairs=${event.metadata.repairAttempts} ${Math.round(event.metadata.durationMs)}ms`
      );
    case "error":
      return `error     ${event.error.code}: ${event.error.message}`;
  }
}

function preview(value: unknown, max = 96): string {
  const text = JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  const client = createClient({
    provider: args.provider,
    ...(args.baseURL ? { baseURL: args.baseURL } : {}),
    timeoutMs: 600_000,
  });

  let model = args.model;
  if (!model) {
    const ids = (await client.listModels()).map((entry) => entry.id);
    model = pickChatModel(ids);
    if (!model) throw new Error(`${client.provider.label} lists no usable chat model.`);
  }

  console.log(`endpoint  ${client.provider.label} (${client.baseURL.origin}) sovereign=${client.provider.sovereign}`);
  console.log(`model     ${model}`);
  console.log(`schema    ${dashboardSchema.name}\n`);

  const started = performance.now();
  const frames: { atMs: number; event: UIStreamEvent<unknown> }[] = [];

  const events = streamObject({
    client,
    model,
    schema: dashboardSchema,
    system:
      "You design compact analytics dashboards. Return one UI document built only from the " +
      "components in the schema. Prefer a Stack root containing a Grid of 3 Metrics, then a Prose note.",
    prompt: `Build a dashboard about: ${args.topic}`,
    sampling: { temperature: 0.2, max_tokens: args.maxTokens },
    frameIntervalMs: args.interval,
    ...(args.force ? { forceStrategy: args.force } : {}),
    onEvent: (trace) => {
      if (trace.type === "strategy_downgraded") {
        console.log(`          (ladder: ${trace.from} -> ${trace.to}: ${trace.reason})`);
      }
    },
  });

  for await (const event of events) {
    const atMs = Math.round(performance.now() - started);
    frames.push({ atMs, event });
    if (!args.quiet) console.log(`${String(atMs).padStart(7)}ms  ${summarise(event)}`);
  }

  if (args.json) writeFileSync(args.json, JSON.stringify(frames, null, 2));

  // --- invariants -----------------------------------------------------------
  const problems: string[] = [];
  const kinds = frames.map((frame) => frame.event.type);

  // A generation that failed before any mechanism engaged is a lone `error`
  // frame: there is no strategy for a `meta` to name.
  const loneError = kinds.length === 1 && kinds[0] === "error";
  if (!loneError) {
    if (kinds[0] !== "meta") problems.push(`first frame is "${kinds[0]}", expected "meta"`);
    if (kinds.filter((kind) => kind === "meta").length !== 1) problems.push("expected exactly one meta frame");
  }

  const terminals = kinds.filter((kind) => kind === "complete" || kind === "error").length;
  const last = kinds[kinds.length - 1];
  if (terminals !== 1) problems.push(`${terminals} terminal frames, expected exactly 1`);
  if (last !== "complete" && last !== "error") problems.push(`last frame is "${last}", not terminal`);

  let expectedSeq = 1;
  const accumulator = new UIStreamAccumulator<unknown>();
  let beforeComplete: JsonValue | undefined;
  let intolerable = 0;

  for (const { event } of frames) {
    if (event.type === "patch" || event.type === "snapshot") {
      if (event.seq !== expectedSeq) problems.push(`seq ${event.seq} where ${expectedSeq} was expected`);
      expectedSeq = event.seq + 1;
    }
    if (event.type === "complete") beforeComplete = accumulator.current();
    try {
      accumulator.apply(event);
    } catch (error) {
      problems.push(`accumulator refused a frame: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    if (event.type === "patch" || event.type === "snapshot") {
      const check = safeParsePartial(dashboardSchema.schema, accumulator.current(), false);
      if (check.status === "invalid") intolerable++;
    }
  }
  if (intolerable > 0) problems.push(`${intolerable} intermediate document(s) the schema would refuse`);

  const completed = accumulator.result();
  if (completed) {
    // The schema may apply defaults, so the completed value can be a superset
    // of the last streamed document — but re-validating that document must
    // produce exactly the completed value.
    const replayed = safeParsePartial(dashboardSchema.schema, beforeComplete, true);
    if (replayed.status !== "ok" || JSON.stringify(replayed.data) !== JSON.stringify(completed.value)) {
      problems.push("replaying the frames does not reproduce the completed value");
    }
  }

  const patches = kinds.filter((kind) => kind === "patch").length;
  const snapshots = kinds.filter((kind) => kind === "snapshot").length;
  const firstPaint = frames.find((frame) => frame.event.type === "patch" || frame.event.type === "snapshot");
  const wireBytes = frames.reduce((sum, frame) => sum + JSON.stringify(frame.event).length + 8, 0);

  console.log(
    `\nframes    ${frames.length} total — ${patches} patch, ${snapshots} snapshot, ` +
      `${wireBytes} bytes on the wire`,
  );
  console.log(
    `timing    first paint ${firstPaint ? `${firstPaint.atMs}ms` : "never"}, ` +
      `finished ${frames[frames.length - 1]?.atMs ?? 0}ms`,
  );

  if (problems.length > 0) {
    console.log(`\nINVARIANTS BROKEN`);
    for (const problem of problems) console.log(`  - ${problem}`);
    return 1;
  }
  console.log(`invariants all held`);

  const failure = accumulator.error();
  if (failure) {
    console.log(`\nresult    FAILED — ${failure.error.code}${failure.error.retryable ? " (retryable)" : ""}`);
    console.log(`message   ${failure.error.message}`);
    if (failure.error.details !== undefined) console.log(`details   ${JSON.stringify(failure.error.details)}`);
    return 1;
  }
  console.log(`result    OK — validated ${dashboardSchema.name} document`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
