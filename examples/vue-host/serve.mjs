/**
 * Serves the example under `script-src 'self'; style-src 'self'`, with the
 * stand-in SDK route. See ../shared/server.mjs.
 *
 *   node serve.mjs [port]
 */
import { fileURLToPath } from "node:url";
import { serve } from "../shared/server.mjs";

serve({
  name: "vue-host",
  root: fileURLToPath(new URL("./public", import.meta.url)),
  port: Number(process.argv[2] ?? process.env.PORT ?? 3301),
});
