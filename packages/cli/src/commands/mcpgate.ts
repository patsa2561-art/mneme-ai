/**
 * `mneme mcpgate` (v3.6.0) — the local-first MCP gateway surface.
 *   mcpgate decide --tool <t> [--args '<json>'] [--agent a]   → ALLOW / NEEDS-APPROVAL / BLOCK
 *   mcpgate audit [--verify]                                   → the signed, offline-verifiable call ledger
 * Every call through `gephyra serve` (HTTP MCP-proxy) and the matrix gRPC rail is gated + audited
 * automatically; this CLI is for manual decisions + verifying the audit chain.
 */
import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mcpgate, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

export function registerMcpgateCommands(program: Command): void {
  const k = program.command("mcpgate").description("🛂 MCP GATEWAY — gate every agent tool-call (policy + behavioral risk + skill provenance → allow / needs-approval / block) and keep a SIGNED, offline-verifiable audit ledger. Local-first; the runtime perimeter a cloud gateway can't be.");

  k.command("decide").description("Gate one tool-call.")
    .requiredOption("--tool <t>", "tool name").option("--args <json>", "args JSON", "{}").option("--agent <a>", "agent id", "agent").option("--json", "emit JSON")
    .action((o: { tool: string; args?: string; agent?: string; json?: boolean }) => {
      let args: unknown = {}; try { args = JSON.parse(o.args ?? "{}"); } catch { /* */ }
      const cwd = process.cwd();
      let policy = {}; try { const pp = join(cwd, ".mneme", "mcpgate", "policy.json"); if (existsSync(pp)) policy = JSON.parse(readFileSync(pp, "utf8")); } catch { /* */ }
      const v = mcpgate.gateCall({ tool: o.tool, agent: o.agent, args }, policy);
      if (o.json) { out(JSON.stringify(v, null, 2)); if (v.decision === "block") process.exitCode = 2; return; }
      const icon = v.decision === "block" ? "🔴" : v.decision === "needs-approval" ? "🟡" : "🟢";
      out(`🛂 ${icon} ${v.decision.toUpperCase()} · ${o.tool} · risk ${v.risk} · args ${v.argsHash.slice(0, 12)}…`);
      for (const r of v.reasons) out(`   • ${r}`);
      if (v.decision === "needs-approval") out("   → route to the human: mneme pager request");
      if (v.decision === "block") process.exitCode = 2;
    });

  k.command("audit").description("Show + verify the call audit ledger (.mneme/mcpgate/audit.jsonl).")
    .option("--verify", "verify the hash-chain + the NOTARY-signed head OFFLINE").option("--tail <n>", "show the last N frames", "10")
    .action((o: { verify?: boolean; tail?: string }) => {
      const dir = join(process.cwd(), ".mneme", "mcpgate"); const ledger = join(dir, "audit.jsonl");
      if (!existsSync(ledger)) { out("no audit ledger yet (no gated calls)"); return; }
      const frames = readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as mcpgate.AuditFrame[];
      const tail = Math.max(1, parseInt(o.tail ?? "10", 10));
      out(`🛂 MCP gateway audit — ${frames.length} call(s)`);
      for (const f of frames.slice(-tail)) out(`   #${f.seq} ${f.decision === "block" ? "🔴" : f.decision === "needs-approval" ? "🟡" : "🟢"} ${f.tool} · ${f.agent} · risk ${f.risk} · args ${f.argsHash.slice(0, 10)}…`);
      if (o.verify) {
        const chain = mcpgate.verifyAuditChain(frames);
        out(chain.ok ? `   ✓ chain VERIFIED — ${chain.frames} frames intact (offline, tamper-evident)` : `   ✗ chain BROKEN at #${chain.brokenAt}: ${chain.reason}`);
        const headPath = join(dir, "audit.head.json");
        if (existsSync(headPath)) { try { const rec = JSON.parse(readFileSync(headPath, "utf8")); const v = notary.verifyReceipt(rec); const head = (rec.payload as { frameId?: string })?.frameId; const last = frames[frames.length - 1]?.frameId; out(v.valid ? `   ✓ signed head VALID (Ed25519, offline)${head === last ? " · points at the current tip" : " · ⚠ tip moved"}` : `   ✗ signed head INVALID: ${v.reason}`); } catch { /* */ } }
        if (!chain.ok) process.exitCode = 2;
      }
    });
}
