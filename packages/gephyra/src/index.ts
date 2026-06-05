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
import { gephyra, hephaestus } from "@mneme-ai/core";

// ── Re-export the engine (the truth-customs primitives live in core) ──
export { gephyra };
// ── HEPHAESTUS — the OS lane of the bridge (command-crossing). Same bridge,
//    applied to shell commands instead of claims. ──
export { hephaestus };
export const crossCommand = hephaestus.crossCommand;
export const classifyCommandRisk = hephaestus.classifyCommandRisk;
export const polyglot = hephaestus.polyglot;
export const crossBridge = gephyra.crossBridge;
export const handleCrossRequest = gephyra.handleCrossRequest;
export const handleMcpCallRequest = gephyra.handleMcpCallRequest;
export const handleSavantRequest = gephyra.handleSavantRequest;
export const handleA2ARequest = gephyra.handleA2ARequest;
export const a2aOpenApi = gephyra.a2aOpenApi;
export const routeToolCall = gephyra.routeToolCall;
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
      if (req.method === "GET" && url.startsWith("/openapi.json")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(gephyra.a2aOpenApi()));
        return;
      }
      const isMcp = url.startsWith("/mcp");
      const isSavantVerify = url.startsWith("/savant/verify");
      const isSavantRepair = url.startsWith("/savant/repair");
      const isFirewall = url.startsWith("/firewall");
      const isRailIngress = url.startsWith("/rail/ingress");
      const isRailEgress = url.startsWith("/rail/egress");
      const isReckon = url.startsWith("/reckon");
      const isA2A = isFirewall || isRailIngress || isRailEgress || isReckon;
      if (req.method !== "POST" || !(url.startsWith("/cross") || isMcp || isSavantVerify || isSavantRepair || isA2A)) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "POST /cross | /mcp | /savant/verify | /savant/repair | /firewall {content} | /rail/ingress {payload} | /rail/egress {payload} | /reckon {evidence}  ·  GET /status | /openapi.json" }));
        return;
      }
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
      req.on("end", () => {
        // /savant/* → savant prosthesis. /firewall · /rail/* · /reckon → A2A safety primitives
        // (trustless-signed). /mcp → MCP tool through truth-customs. /cross → verify a claim.
        const handler = isSavantVerify ? gephyra.handleSavantRequest(repoRoot, body, "verify")
          : isSavantRepair ? gephyra.handleSavantRequest(repoRoot, body, "repair")
          : isFirewall ? gephyra.handleA2ARequest(repoRoot, body, "firewall")
          : isRailIngress ? gephyra.handleA2ARequest(repoRoot, body, "rail-ingress")
          : isRailEgress ? gephyra.handleA2ARequest(repoRoot, body, "rail-egress")
          : isReckon ? gephyra.handleA2ARequest(repoRoot, body, "reckon")
          : isMcp ? gephyra.handleMcpCallRequest(repoRoot, body)
          : gephyra.handleCrossRequest(repoRoot, body);
        void handler
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
