/**
 * `mneme agentcert` (v3.7.0) — the Agent Run Certificate.
 *   agentcert build [--run <id>] [--task "…"] [--agent "…"] --out cert.json   → a signed, self-contained certificate
 *   agentcert verify <cert.json>                                              → verify OFFLINE (no Mneme, no vendor)
 * The build embeds the run's evidence (MCP-gateway audit chain + human approvals) and NOTARY-signs
 * the whole thing, so an insurer / auditor / customer verifies the entire governed run from ONE file.
 */
import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentcert, agentLiability, notary } from "@mneme-ai/core";

function out(s: string): void { process.stdout.write(s + "\n"); }

function loadFrames(cwd: string, run?: string): agentcert.RunEvidence["auditFrames"] {
  const p = join(cwd, ".mneme", "mcpgate", "audit.jsonl");
  if (!existsSync(p)) return [];
  const all = readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as agentcert.RunEvidence["auditFrames"];
  return run ? all.filter((f) => f.run === run) : all;
}
function loadApprovals(cwd: string): agentcert.RunApproval[] {
  try {
    const st = JSON.parse(readFileSync(join(cwd, ".mneme", "pager", "state.json"), "utf8")) as { receipts?: Array<{ req?: { id?: string }; decision?: string; channel?: string; decidedBy?: string; at?: number }> };
    return (st.receipts ?? []).filter((r) => r.decidedBy === "human").map((r) => ({ id: String(r.req?.id ?? ""), decision: (r.decision === "deny" ? "deny" : "allow") as "allow" | "deny", by: "human", on: String(r.channel ?? "pager"), at: Number(r.at) || 0 }));
  } catch { return []; }
}

export function registerAgentcertCommands(program: Command): void {
  const k = program.command("agentcert").description("🎖 AGENT RUN CERTIFICATE — one portable, offline-verifiable certificate per governed agent run (the audit chain + human approvals, NOTARY-signed). The piece a giant adopts + an insurer underwrites: no vendor can issue it for itself.");

  k.command("build").description("Build + sign a certificate for a run (or the whole audit ledger).")
    .option("--run <id>", "only this run's audit frames (default: all)").option("--task <t>", "the run's task").option("--agent <a>", "agent/vendor name").option("--model <m>", "model id")
    .option("--out <file>", "write the signed certificate").option("--json", "print the signed certificate JSON")
    .action((o: { run?: string; task?: string; agent?: string; model?: string; out?: string; json?: boolean }) => {
      const cwd = process.cwd();
      const auditFrames = loadFrames(cwd, o.run);
      if (!auditFrames.length) { out(`✗ no audit frames${o.run ? ` for run ${o.run}` : ""} — run some gated tool-calls first (mneme mcpgate / gephyra serve / matrix).`); process.exitCode = 2; return; }
      const approvals = loadApprovals(cwd);
      const ev: agentcert.RunEvidence = {
        runId: o.run || auditFrames[0].run || "all", agent: o.agent || auditFrames[0].agent || "agent", model: o.model, task: o.task,
        startedAt: auditFrames[0].ts, endedAt: auditFrames[auditFrames.length - 1].ts, auditFrames, approvals,
      };
      const cert = agentcert.buildCertificate(ev);
      // self-contained, portable: embed the evidence + sign the whole thing for offline verify
      const payload = { cert, evidence: ev };
      let signed: unknown = payload;
      try { signed = notary.issueReceipt(cwd, { kind: "reasoning-trace", subject: `agent-run-cert:${cert.runId}`, payload, includePayload: true, issuedAt: Date.now() }); } catch { /* */ }
      if (o.out) writeFileSync(o.out, JSON.stringify(signed, null, 2), "utf8");
      if (o.json) { out(JSON.stringify(signed, null, 2)); return; }
      const s = cert.summary;
      const ico = s.insurability === "insurable" ? "🟢" : s.insurability === "review" ? "🟡" : "🔴";
      out(`🎖 AGENT RUN CERTIFICATE — ${cert.agent}${cert.task ? ` · "${cert.task}"` : ""} · ${ico} ${s.insurability.toUpperCase()}`);
      out(`   ${s.calls} gated call(s): ${s.allowed} allowed · ${s.blocked} blocked · ${s.needsApproval} escalated · ${s.humanApprovals + s.humanDenials} human decision(s)`);
      out(`   policy-compliant: ${s.policyCompliant ? "yes" : "NO"} · audit chain: ${s.auditChainOk ? "intact" : "BROKEN"} · max risk ${s.riskMax}`);
      out(`   evidence sha256 ${cert.evidenceHash.slice(0, 16)}…${o.out ? ` · 🎖 signed → ${o.out}` : ""} (verify offline: mneme agentcert verify)`);
    });

  k.command("verify <file>").description("Verify a certificate OFFLINE — the signature, the embedded audit chain, and that the summary RE-DERIVES from the evidence (the cert cannot lie about its run).")
    .action((file: string) => {
      if (!existsSync(file)) { out("certificate not found"); process.exitCode = 2; return; }
      let signed: { payload?: { cert?: agentcert.AgentRunCertificate; evidence?: agentcert.RunEvidence } };
      try { signed = JSON.parse(readFileSync(file, "utf8")); } catch { out("✗ invalid certificate JSON"); process.exitCode = 2; return; }
      const sig = notary.verifyReceipt(signed);
      out(sig.valid ? "✓ signature VALID (Ed25519, offline — proves who issued it)" : `✗ signature INVALID: ${sig.reason}`);
      const cert = signed.payload?.cert, evidence = signed.payload?.evidence;
      if (!cert || !evidence) { out("✗ certificate has no embedded cert/evidence"); process.exitCode = 2; return; }
      const v = agentcert.verifyCertificate(cert, evidence);
      out(v.valid ? "✓ run VERIFIED — " + v.reasons[0] : "✗ run NOT verified:");
      if (!v.valid) for (const r of v.reasons) out("   • " + r);
      const s = cert.summary;
      out(`   → ${cert.agent}${cert.task ? ` · "${cert.task}"` : ""}: ${s.calls} gated calls · ${s.blocked} blocked · insurability ${s.insurability}`);
      if (!sig.valid || !v.valid) process.exitCode = 2;
    });

  k.command("insure <file>").description("Underwrite an agent run: turn a signed certificate into a liability assessment (coverage band + premium multiplier on the insurer's base rate). Verifies the cert first — an unverified or non-compliant run is declined.")
    .option("--vendor-false-rate <n>", "the vendor's measured false-rate (Wilson LB, 0..1) — tightens the premium", parseFloat)
    .option("--out <file>", "write the signed liability certificate").action((file: string, o: { vendorFalseRate?: number; out?: string }) => {
      if (!existsSync(file)) { out("certificate not found"); process.exitCode = 2; return; }
      let signed: { payload?: { cert?: agentcert.AgentRunCertificate; evidence?: agentcert.RunEvidence } };
      try { signed = JSON.parse(readFileSync(file, "utf8")); } catch { out("✗ invalid certificate JSON"); process.exitCode = 2; return; }
      const cert = signed.payload?.cert, evidence = signed.payload?.evidence;
      if (!cert || !evidence) { out("✗ certificate has no embedded cert/evidence"); process.exitCode = 2; return; }
      const sig = notary.verifyReceipt(signed); const v = agentcert.verifyCertificate(cert, evidence);
      const certVerified = sig.valid && v.valid;
      const lc = agentLiability.buildLiabilityCertificate({ cert, certVerified, vendorFalseRateLB: o.vendorFalseRate }, Date.now());
      let outSigned: unknown = lc;
      try { outSigned = notary.issueReceipt(process.cwd(), { kind: "claim-verdict", subject: `agent-run-liability:${lc.certRunId}`, payload: lc, includePayload: true, issuedAt: Date.now() }); } catch { /* */ }
      if (o.out) writeFileSync(o.out, JSON.stringify(outSigned, null, 2), "utf8");
      const ico = lc.coverageBand === "full" ? "🟢" : lc.coverageBand === "standard" ? "🟢" : lc.coverageBand === "conditional" ? "🟡" : "🔴";
      out(`🛡 AGENT-RUN LIABILITY — ${lc.agent}${cert.task ? ` · "${cert.task}"` : ""} · ${ico} ${lc.coverageBand.toUpperCase()}${lc.insurable ? "" : " (declined)"}`);
      out(`   cert verified: ${certVerified ? "yes" : "NO"} · risk ${lc.riskScore} · human-oversight ${Math.round(lc.oversightRatio * 100)}% · premium ×${lc.premiumMultiplier} (on the insurer's base rate)`);
      for (const r of lc.reasons) out(`   • ${r}`);
      if (lc.insurable) { out(`   conditions: ${lc.conditions.length} · voids: ${lc.voidIf.length}${o.out ? ` · 🛡 signed → ${o.out}` : ""}`); }
      if (!lc.insurable) process.exitCode = 2;
    });
}
