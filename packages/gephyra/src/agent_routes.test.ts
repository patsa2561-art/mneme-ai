import { describe, it, expect } from "vitest";
import { handleAgentRequest } from "./index.js";
import { mcpgate } from "@mneme-ai/core";
const repo = process.cwd();
describe("gephyra /agent/* — governance over HTTP for any vendor", () => {
  it("gate blocks a destructive call + signs the result", async () => {
    const r = await handleAgentRequest(repo, JSON.stringify({ tool: "bash", args: { command: "rm -rf / --no-preserve-root" }, agent: "Grok" }), "gate");
    expect(r.status).toBe(200); const b = r.body as { decision: string; _proof?: unknown };
    expect(b.decision).toBe("block"); expect(b._proof).toBeTruthy();
  });
  it("cert build → verify → insure end to end", async () => {
    let prev = null as never; const frames: unknown[] = [];
    for (const c of [{ tool: "read_file", d: "allow" as const, r: 0.2 }, { tool: "deploy", d: "block" as const, r: 0.95 }]) {
      const f = mcpgate.appendAuditFrame(prev, { tool: c.tool, agent: "Grok", run: "R" }, { decision: c.d, risk: c.r, reasons: [], argsHash: "h" + c.tool }, 1000 + frames.length);
      frames.push(f); prev = f as never;
    }
    const cb = await handleAgentRequest(repo, JSON.stringify({ agent: "Grok", task: "x", run: "R", frames }), "cert-build");
    const cbb = cb.body as { cert: unknown; evidence: unknown };
    const cv = await handleAgentRequest(repo, JSON.stringify({ cert: cbb.cert, evidence: cbb.evidence }), "cert-verify");
    expect((cv.body as { valid: boolean }).valid).toBe(true);
    const ins = await handleAgentRequest(repo, JSON.stringify({ cert: cbb.cert, certVerified: true }), "insure");
    const ib = ins.body as { coverageBand: string; insurable: boolean; _proof?: unknown };
    expect(ib.insurable).toBe(true); expect(ib._proof).toBeTruthy();
  });
  it("an unverified cert is declined by insure", async () => {
    const cb = await handleAgentRequest(repo, JSON.stringify({ agent: "g", run: "R2", frames: [{ seq: 0, ts: 1, run: "R2", tool: "read", agent: "g", argsHash: "h", decision: "allow", risk: 0.1, prev: "", frameId: "x" }] }), "cert-build");
    const cbb = cb.body as { cert: unknown };
    const ins = await handleAgentRequest(repo, JSON.stringify({ cert: cbb.cert, certVerified: false }), "insure");
    expect((ins.body as { coverageBand: string }).coverageBand).toBe("declined");
  });
});
