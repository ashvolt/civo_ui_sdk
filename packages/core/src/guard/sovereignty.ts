import { RelaxUIError } from "../errors.js";

/**
 * relaxAI's selling point is jurisdictional: inference runs in UK data centres
 * and nothing leaves them. An SDK that silently accepts any `baseURL` hands
 * that guarantee back. So the transport refuses to dial a host the application
 * did not explicitly vouch for.
 */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = ["api.relax.ai"];

export interface SovereigntyPolicy {
  /**
   * Hostnames (exact) or suffix patterns (`*.example.com`) this deployment is
   * permitted to send prompts to. Defaults to relaxAI's public endpoint.
   */
  allowedHosts?: readonly string[];
  /**
   * Permit `http://` (and so plaintext prompts on the wire). Only sensible for
   * a loopback gateway in development; refused for any non-loopback host.
   */
  allowInsecureTransport?: boolean;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function hostMatches(host: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === pattern;
}

/**
 * Validates a base URL against the deployment's sovereignty policy.
 *
 * @throws {RelaxUIError} `sovereignty_violation` if the host is not allowlisted,
 *   or `config_invalid` if the URL cannot be parsed.
 */
export function assertSovereignEndpoint(baseURL: string, policy: SovereigntyPolicy = {}): URL {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch (cause) {
    throw new RelaxUIError({
      code: "config_invalid",
      message: `baseURL is not a valid absolute URL: ${baseURL}`,
      cause,
    });
  }

  const allowed = policy.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  const host = url.hostname.toLowerCase();
  const isLoopback = LOOPBACK.has(host);

  if (url.protocol !== "https:") {
    const tolerated = url.protocol === "http:" && policy.allowInsecureTransport === true && isLoopback;
    if (!tolerated) {
      throw new RelaxUIError({
        code: "sovereignty_violation",
        message:
          `Refusing to send prompts over ${url.protocol}//. Use https, or set ` +
          `allowInsecureTransport with a loopback host for local development.`,
        details: { host, protocol: url.protocol },
      });
    }
  }

  const permitted = allowed.some((pattern) => hostMatches(host, pattern)) || (isLoopback && policy.allowInsecureTransport === true);
  if (!permitted) {
    throw new RelaxUIError({
      code: "sovereignty_violation",
      message:
        `Host "${host}" is not in the sovereignty allowlist (${allowed.join(", ")}). ` +
        `Add it to the client's sovereignty.allowedHosts if this endpoint is genuinely one ` +
        `this deployment may send prompts to.`,
      details: { host, allowed: [...allowed] },
    });
  }

  return url;
}
