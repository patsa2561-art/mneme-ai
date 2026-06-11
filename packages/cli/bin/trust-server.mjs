#!/usr/bin/env node
// Standalone Trust Gateway HTTP server — the AI-native SaaS front door, for systemd/hosting.
// Stateless: an AI agent POSTs a proposed change, gets a signed PASS/WARN/BLOCK verdict.
// No daemon, no warm-call, no CLI bootstrap — just the trust suite over HTTP.
import { createServer } from "node:http";
import { createContext, runInContext } from "node:vm";
import { trustService, equivReceipt } from "@mneme-ai/core";

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "127.0.0.1";

const compile = (src) => {
  const ctx = createContext(Object.freeze({ Math, Number, String, Boolean, Array, Object, JSON, isNaN, parseInt, parseFloat }));
  const fn = runInContext("(" + src + ")", ctx, { timeout: 1000 });
  if (typeof fn !== "function") throw new Error("not a function expression");
  return fn;
};

const server = createServer((req, res) => {
  const send = (status, json) => { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(json)); };
  if ((req.method || "").toUpperCase() === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }); return res.end(); }
  const chunks = []; let size = 0;
  req.on("data", (c) => { size += c.length; if (size > 16 * 1024 * 1024) req.destroy(); else chunks.push(c); });
  req.on("end", () => {
    let body = {}; try { const raw = Buffer.concat(chunks).toString("utf8"); if (raw) body = JSON.parse(raw); } catch { return send(400, { error: "invalid JSON body" }); }
    const path = (req.url || "/").split("?")[0];
    try {
      if ((path === "/" || path === "/index.html") && (req.method || "GET").toUpperCase() === "GET" && /text\/html/.test(req.headers["accept"] || "")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "access-control-allow-origin": "*" }); return res.end(trustService.landingPage());
      }
      if (path.replace(/\/+$/, "") === "/equiv" && (req.method || "").toUpperCase() === "POST") {
        const spec = Array.isArray(body.args) ? body.args.map((a) => ({ name: String(a.name ?? "x"), type: ["number", "int", "string", "bool"].includes(String(a.type)) ? String(a.type) : "number" })) : [];
        const inputs = equivReceipt.genInputs(spec.length ? spec : [{ name: "x", type: "number" }], { fuzz: Number(body.fuzz) || 1500 });
        const r = equivReceipt.differential(compile(String(body.oldFn || "")), compile(String(body.newFn || "")), inputs);
        return send(200, equivReceipt.buildReceipt("refactor", String(body.oldFn || ""), String(body.newFn || ""), r));
      }
      const r = trustService.routeTrust({ method: req.method || "GET", path, body }, { today: new Date().toISOString().slice(0, 10) });
      send(r.status, r.json);
    } catch (e) { send(500, { error: String(e && e.message || e).slice(0, 200) }); }
  });
});
server.listen(PORT, HOST, () => console.log(`Mneme Trust Gateway on http://${HOST}:${PORT}`));
