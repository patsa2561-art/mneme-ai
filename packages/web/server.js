#!/usr/bin/env node
// Tiny zero-dep HTTP server for the Mneme web UI.
// Serves /public/* and a stubbed /api/graph endpoint.
// Replace with the real graph builder in phase 4.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const PORT = Number(process.env.MNEME_PORT ?? 4711);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  try {
    if (req.url === "/api/graph") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(stubGraph(), null, 2));
      return;
    }
    let path = req.url === "/" ? "/index.html" : req.url ?? "/index.html";
    path = path.split("?")[0];
    const file = join(PUBLIC_DIR, path);
    const data = await readFile(file);
    const mime = MIME[extname(file)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": mime });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

server.listen(PORT, () => {
  process.stdout.write(`mneme web → http://localhost:${PORT}\n`);
});

function stubGraph() {
  return {
    note: "phase 4 stub — replace with output of the real graph builder",
    nodes: [
      { id: "commit:a1b2c3", kind: "commit", label: "Refactor payment flow" },
      { id: "incident:SENTRY-1287", kind: "incident", label: "Stripe webhook 500" },
      { id: "entity:PaymentService.charge", kind: "entity", label: "PaymentService.charge" },
    ],
    links: [
      { source: "commit:a1b2c3", target: "incident:SENTRY-1287", weight: 0.82 },
      { source: "commit:a1b2c3", target: "entity:PaymentService.charge", weight: 1 },
    ],
  };
}
