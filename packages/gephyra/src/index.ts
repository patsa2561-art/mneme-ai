/**
 * @mneme-ai/gephyra — GEPHYRA, the living bridge / Toll Booth of Truth.
 *
 * The deployable SURFACE of Mneme. The truth-customs engine lives in
 * @mneme-ai/core (where it is tested + composed from every Mneme organ); this
 * package re-exports it and adds the deployable HTTP server + `gephyra` bin, so
 * GEPHYRA can run standalone in front of any agent/protocol without pulling in
 * the full Mneme CLI. Mneme = the brain; GEPHYRA = the face.
 *
 *   import { startServer, crossBridge } from "@mneme-ai/gephyra";
 *   const bridge = await startServer({ port: 17742 });   // POST /cross
 */

import { createServer, type Server } from "node:http";
import { gephyra } from "@mneme-ai/core";

// ── Re-export the engine (the truth-customs primitives live in core) ──
export { gephyra };
export const crossBridge = gephyra.crossBridge;
export const handleCrossRequest = gephyra.handleCrossRequest;
export const bridgeStatus = gephyra.bridgeStatus;
export const bridgeReplay = gephyra.bridgeReplay;
export const verifyCrossing = gephyra.verifyCrossing;
export const apoptosisTruthCustoms = gephyra.apoptosisTruthCustoms;
export const gephyraAdvertisement = gephyra.gephyraAdvertisement;
export const newCapabilitiesSince = gephyra.newCapabilitiesSince;

export const GEPHYRA_DEFAULT_PORT = 17742;

export interface ServeHandle {
  server: Server;
  /** The actual bound port (resolved even when you pass 0 for an ephemeral port). */
  port: number;
  /** Graceful shutdown. */
  close: () => Promise<void>;
}

/**
 * Start GEPHYRA as a standalone HTTP endpoint. `POST /cross` with
 * `{ claim, fromAgent, toAgent?, action? }` runs the crossing through real-time
 * truth-customs (7-layer ACGV) and returns the signed result. `GET /status`
 * returns the live bridge status. Never crashes on a bad request (400 JSON).
 * Resolves once the server is listening (port 0 ⇒ OS-assigned ephemeral port).
 */
export function startServer(opts: { repoRoot?: string; port?: number; host?: string } = {}): Promise<ServeHandle> {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const port = typeof opts.port === "number" ? opts.port : GEPHYRA_DEFAULT_PORT;
  return new Promise((resolveP, rejectP) => {
    const server = createServer((req, res) => {
      const url = req.url ?? "";
      if (req.method === "GET" && url.startsWith("/status")) {
        const s = gephyra.bridgeStatus(repoRoot);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(s));
        return;
      }
      if (req.method !== "POST" || !url.startsWith("/cross")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "POST /cross {claim, fromAgent}  |  GET /status" }));
        return;
      }
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
      req.on("end", () => {
        void gephyra.handleCrossRequest(repoRoot, body)
          .then((r) => { res.writeHead(r.status, { "content-type": "application/json" }); res.end(JSON.stringify(r.body)); })
          .catch((e: Error) => { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: e.message })); });
      });
    });
    server.once("error", rejectP);
    server.listen(port, opts.host ?? "127.0.0.1", () => {
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      resolveP({
        server,
        port: boundPort,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
