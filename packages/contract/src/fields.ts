import { sanitizeUrl, type UrlPolicy } from "relax-ui-protocol";
import { z } from "zod";

/**
 * A string prop that is safe to put in an `href` or `src`.
 *
 * `z.string().url()` checks syntax; it happily accepts `javascript:alert(1)`,
 * which is a valid URL and an XSS. This refines *and* normalises through the
 * SDK's URL guard, so a rejected scheme fails schema validation rather than
 * reaching the DOM.
 */
export function urlString(policy: UrlPolicy = {}): z.ZodType<string> {
  return z
    .string()
    .describe("An absolute https URL, a site-relative path, or a mailto: link.")
    .superRefine((value, ctx) => {
      if (sanitizeUrl(value, policy) === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "URL scheme or host is not permitted by the generative-UI URL policy.",
        });
      }
    })
    .transform((value) => sanitizeUrl(value, policy) as string);
}

/** Plain display text: no control characters, bounded length. */
export function displayText(maxLength = 2_000): z.ZodType<string> {
  return z
    .string()
    .max(maxLength)
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f]*$/, "Control characters are not allowed.");
}
