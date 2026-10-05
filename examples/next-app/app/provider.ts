import {
  createClient,
  discoverChatModel,
  resolveProvider,
  type InferenceClient,
  type ProviderProfile,
} from "relax-ui-core";

/**
 * Which inference endpoint this demo talks to.
 *
 * relaxAI is the default and the point of the SDK. A local provider exists so
 * the demo can be run — and reviewed — with no relaxAI account, against an
 * open-weight model on your own machine, through exactly the engine, validator
 * and wire protocol that would ship.
 *
 * Everything endpoint-specific now lives in the SDK's provider profiles: the
 * address, the egress allowlist, whether a key is needed, how that runtime's
 * constrained decoder differs. This file only decides *which* profile, which
 * model, and how patient to be — the three things that are genuinely the
 * application's call.
 *
 * What a local provider is NOT is a way around the sovereignty guard. The guard
 * runs for every provider; a local one simply carries a loopback-only policy,
 * and pointing it at a remote host is refused exactly as it would be in
 * production. If that distinction stops being visible, this file is wrong — see
 * `isSovereign`, which the UI uses to say so out loud.
 */

export interface ProviderConfig {
  id: string;
  label: string;
  /** False for every local provider, and surfaced in the UI. Never quietly true. */
  isSovereign: boolean;
  isLocal: boolean;
  client: InferenceClient;
  /** A fixed name, or a resolver that asks the endpoint what it has. */
  model: string | (() => Promise<string>);
  /** Local models are slower and smaller; the demo adapts its ask. */
  sampling: { temperature: number; max_tokens: number };
  frameIntervalMs: number;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * The profile `RELAX_UI_PROVIDER` selects; relaxAI when it is unset.
 *
 * Throws on a name it does not recognise. This used to warn and fall back to
 * relaxAI, which meant a typo either failed with a missing-key error pointing
 * nowhere near the mistake or, with a key present, quietly sent prompts to an
 * endpoint nobody chose. A misconfiguration that looks like it worked is the
 * one bug class this SDK exists to prevent.
 */
export function activeProfile(): ProviderProfile {
  return resolveProvider(env("RELAX_UI_PROVIDER") ?? "relaxai");
}

/** Where `profile` will be reached, honouring its own environment override. */
function baseURLOf(profile: ProviderProfile): string {
  for (const name of profile.baseURLEnv ?? []) {
    const value = env(name);
    if (value) return value;
  }
  return profile.baseURL;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Provider identity without building a client.
 *
 * The page needs to label the endpoint, and must not need an API key to do it —
 * constructing a client would throw during render when `RELAX_API_KEY` is
 * unset, which is exactly the state someone reviewing the demo is in.
 */
export function describeActiveProvider(): {
  id: string;
  label: string;
  isSovereign: boolean;
  isLocal: boolean;
} {
  const profile = activeProfile();
  return {
    id: profile.id,
    label: `${profile.label} (${hostOf(baseURLOf(profile))})`,
    isSovereign: profile.sovereign,
    isLocal: profile.local,
  };
}

/**
 * A model name for this deployment, or a way to find one.
 *
 * `RELAX_UI_MODEL` pins it for any provider; `OLLAMA_MODEL` and `RELAX_MODEL`
 * are still read, for `.env` files written against the first version of this
 * demo. With nothing pinned, a hosted provider gets a sensible default and a
 * local one is asked what it has installed.
 */
function modelFor(profile: ProviderProfile, client: InferenceClient): ProviderConfig["model"] {
  const legacy = profile.id === "ollama" ? "OLLAMA_MODEL" : profile.id === "relaxai" ? "RELAX_MODEL" : undefined;
  const pinned = env("RELAX_UI_MODEL") ?? (legacy ? env(legacy) : undefined);
  if (pinned) return pinned;
  if (!profile.local) return "Llama-4-Maverick-17B-128E";

  // Resolved lazily and memoised rather than at module scope: a dev server
  // should start even when the local runtime is not running, and fail with a
  // clear message on the first request instead of refusing to boot.
  let discovered: Promise<string> | undefined;
  return async () => {
    discovered ??= discoverChatModel(client);
    try {
      return await discovered;
    } catch (error) {
      discovered = undefined; // so a later request retries rather than caching the failure
      throw error;
    }
  };
}

function build(): ProviderConfig {
  const profile = activeProfile();
  const client = createClient({
    provider: profile,
    // Redaction is on for the hosted endpoint, where a prompt crosses a network.
    // On loopback it would only make a local demo's output harder to recognise.
    ...(profile.local
      ? {}
      : {
          redaction: true,
          onRedaction: (hits: Record<string, number>) =>
            console.warn("[relax-ui] redacted outbound prompt", hits),
        }),
  });

  return {
    id: profile.id,
    label: `${profile.label} (${client.baseURL.host})`,
    isSovereign: profile.sovereign,
    isLocal: profile.local,
    client,
    model: modelFor(profile, client),
    sampling: profile.local
      ? // Lower temperature because smaller models wander. The budget is *not*
        // tightened to match: a budget that runs out mid-document produces a
        // `truncated` error and nothing to render, which reads as the SDK
        // failing when it is the allowance that was wrong.
        { temperature: 0.2, max_tokens: 3_000 }
      : { temperature: 0.4, max_tokens: 2_000 },
    // Local token rates are lower, so a tighter throttle buys nothing.
    frameIntervalMs: profile.local ? 80 : 50,
  };
}

let cached: ProviderConfig | undefined;

/** The active provider. Built once per server process. */
export function getProvider(): ProviderConfig {
  cached ??= build();
  return cached;
}
