/**
 * Reads an environment variable without assuming there is a `process`.
 *
 * Core runs on Workers and the Edge runtime, where `process` may be absent or a
 * partial shim, so this goes through `globalThis` rather than a `node:` import.
 * Empty and whitespace-only values count as unset: an `.env` line left blank
 * should mean "use the default", not "use the empty string".
 */
export function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = env?.[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** First set variable among `names`, in order. */
export function readFirstEnv(names: readonly string[] | undefined): string | undefined {
  for (const name of names ?? []) {
    const value = readEnv(name);
    if (value !== undefined) return value;
  }
  return undefined;
}
