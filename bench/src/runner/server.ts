import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";

/**
 * Serves the built pages and each step's encoded frames, on 127.0.0.1 only
 * (NFR-403). Frames are registered in memory; a page fetches them before its
 * run starts, so loading them is never timed.
 */
export interface BenchServer {
  url: string;
  put(id: string, body: unknown): string;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".json": "application/json",
};

export async function startServer(root: string): Promise<BenchServer> {
  const data = new Map<string, string>();
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path.startsWith("/data/")) {
      const body = data.get(path.slice(6));
      if (body === undefined) return void res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(body);
      return;
    }
    const file = normalize(join(root, path));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`,
    put(id, body) {
      data.set(id, JSON.stringify(body));
      return `/data/${id}`;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
