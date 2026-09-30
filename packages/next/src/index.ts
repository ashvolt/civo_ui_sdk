/**
 * relax-ui-next — Next.js App Router adapter for the relaxAI
 * Generative UI SDK.
 *
 * Imports nothing from `next` itself: the handlers are `(Request) => Response`,
 * which is what the App Router wants and what the Edge runtime, Cloudflare
 * Workers and a plain `fetch` test all accept unchanged.
 */

export { createGenerativeObjectRoute, createGenerativeUIRoute } from "./route.js";
export type { GenerativeUIRouteConfig, GenerativeUIRouteHandler, ModelResolver } from "./route.js";
