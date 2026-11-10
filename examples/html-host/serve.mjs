/**
 * Serves the example under `script-src 'self'; style-src 'self'` (T-248), with
 * the stand-in SDK route. See ../shared/server.mjs.
 *
 *   node serve.mjs [port]
 */
import { fileURLToPath } from "node:url";
import { serve } from "../shared/server.mjs";

serve({
  name: "html-host",
  root: fileURLToPath(new URL("./public", import.meta.url)),
  port: Number(process.argv[2] ?? process.env.PORT ?? 3300),
});
