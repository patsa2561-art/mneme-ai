/**
 * @mneme-ai/gephyra package tests — the deployable surface.
 *   PK1 re-exports the engine from core
 *   PK2 startServer (ephemeral port) handles POST /cross end-to-end + GET /status, then closes
 *   PK3 a bad request returns 404 / 400 without crashing the server
 *   PK4 POST /mcp routes an MCP tool call through truth-customs (shell→hephaestus gate · claim→gephyra correct)
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { startServer, crossBridge, handleCrossRequest, handleMcpCallRequest, routeToolCall, bridgeStatus, gephyra } from "./index.js";

function http(method: string, port: number, path: string, body?: string): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { "content-type": "application/json" } }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => { let json: unknown = null; try { json = JSON.parse(data); } catch { /* */ } resolve({ status: res.statusCode ?? 0, json }); });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("@mneme-ai/gephyra package", () => {
  it("PK1 re-exports the engine from core", () => {
    expect(typeof crossBridge).toBe("function");
    expect(typeof handleCrossRequest).toBe("function");
    expect(typeof handleMcpCallRequest).toBe("function");
    expect(typeof routeToolCall).toBe("function");
    expect(typeof bridgeStatus).toBe("function");
    expect(typeof gephyra.apoptosisTruthCustoms).toBe("function");
  });

  it("PK2 startServer handles POST /cross + GET /status end-to-end (ephemeral port)", async () => {
    const repo = mkdtempSync(join(tmpdir(), "gephyra-pkg-"));
    const h = await startServer({ repoRoot: repo, port: 0 });
    try {
      expect(h.port).toBeGreaterThan(0);
      const cross = await http("POST", h.port, "/cross", JSON.stringify({ claim: "2+2=5", fromAgent: "tester" }));
      expect(cross.status).toBe(200);
      expect((cross.json as { disposition?: string }).disposition).toBe("CORRECTED"); // arithmetic backstop
      const status = await http("GET", h.port, "/status");
      expect(status.status).toBe(200);
      expect((status.json as { crossings?: number }).crossings).toBeGreaterThanOrEqual(1);
    } finally {
      await h.close();
    }
  }, 15_000);

  it("PK3 bad input + wrong route don't crash the server", async () => {
    const repo = mkdtempSync(join(tmpdir(), "gephyra-pkg-"));
    const h = await startServer({ repoRoot: repo, port: 0 });
    try {
      expect((await http("POST", h.port, "/cross", "not json")).status).toBe(400);
      expect((await http("GET", h.port, "/nope")).status).toBe(404);
      // server still alive after the bad requests
      expect((await http("POST", h.port, "/cross", JSON.stringify({ claim: "ok", fromAgent: "a" }))).status).toBe(200);
    } finally {
      await h.close();
    }
  }, 15_000);

  it("PK4 POST /mcp routes a tool call through truth-customs (shell→hephaestus · claim→gephyra)", async () => {
    const repo = mkdtempSync(join(tmpdir(), "gephyra-pkg-"));
    const h = await startServer({ repoRoot: repo, port: 0 });
    try {
      // a destructive shell tool call → HEPHAESTUS lane, gated (never auto-allow without co-sign)
      const shell = await http("POST", h.port, "/mcp", JSON.stringify({ tool: "shell.exec", agent: "claude", args: { command: "rm -rf /important" } }));
      expect(shell.status).toBe(200);
      const sb = shell.json as { lane?: string; action?: string };
      expect(sb.lane).toBe("hephaestus");
      expect(sb.action === "gate" || sb.action === "block").toBe(true);
      // a claim-bearing tool call → GEPHYRA lane, false arithmetic CORRECTED
      const claim = await http("POST", h.port, "/mcp", JSON.stringify({ tool: "answer.send", agent: "gpt", args: { claim: "2+2=5" } }));
      expect(claim.status).toBe(200);
      const cb = claim.json as { lane?: string; claim?: { disposition?: string } };
      expect(cb.lane).toBe("gephyra");
      // a tool with nothing to inspect → passthrough
      const pass = await http("POST", h.port, "/mcp", JSON.stringify({ tool: "list_files", agent: "claude", args: {} }));
      expect((pass.json as { lane?: string }).lane).toBe("passthrough");
      // bad body → 400, server survives
      expect((await http("POST", h.port, "/mcp", "not json")).status).toBe(400);
      expect((await http("GET", h.port, "/status")).status).toBe(200);
    } finally {
      await h.close();
    }
  }, 20_000);

  it("PK5 POST /savant/verify + /savant/repair — the A2A prosthesis (any agent over HTTP)", async () => {
    const repo = mkdtempSync(join(tmpdir(), "gephyra-pkg-"));
    const h = await startServer({ repoRoot: repo, port: 0 });
    try {
      // savant verify: a provable falsehood → FALSE with a signed receipt
      const v = await http("POST", h.port, "/savant/verify", JSON.stringify({ claim: "2+2=5" }));
      expect(v.status).toBe(200);
      const vb = v.json as { verdict?: string; receiptId?: string | null };
      expect(vb.verdict).toBe("FALSE");
      expect(vb.receiptId).toBeTruthy();
      // an unprovable claim → UNKNOWN (never guessed)
      const u = await http("POST", h.port, "/savant/verify", JSON.stringify({ claim: "the 9000th visitor tomorrow wears red" }));
      expect((u.json as { verdict?: string }).verdict).toBe("UNKNOWN");
      // savant repair: a draft with a false claim → changed, with a correction marker
      const r = await http("POST", h.port, "/savant/repair", JSON.stringify({ draft: "The total is 2+2=5." }));
      expect(r.status).toBe(200);
      const rb = r.json as { changed?: boolean; falseCount?: number; repaired?: string };
      expect(rb.changed).toBe(true);
      expect(rb.falseCount).toBe(1);
      expect(rb.repaired).toMatch(/FALSE/);
      // bad body → 400, server survives
      expect((await http("POST", h.port, "/savant/verify", "not json")).status).toBe(400);
      expect((await http("GET", h.port, "/status")).status).toBe(200);
    } finally {
      await h.close();
    }
  }, 20_000);
});
