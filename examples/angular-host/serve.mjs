/**
 * Serves the AOT build under `script-src 'self'` and `style-src 'self'` plus a
 * fresh nonce per page for the styles Angular adds at runtime. See
 * ../shared/server.mjs.
 *
 *   node serve.mjs [port]
 */
import { fileURLToPath } from "node:url";
import { serve } from "../shared/server.mjs";

serve({
  name: "angular-host",
  root: fileURLToPath(new URL("./dist/browser", import.meta.url)),
  port: Number(process.argv[2] ?? process.env.PORT ?? 3302),
  nonce: true,
});
