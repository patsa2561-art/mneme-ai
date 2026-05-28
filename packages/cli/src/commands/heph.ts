/**
 * v2.86.0 — `mneme heph <action>` (alias `hephaestus`) · GEPHYRA's OS lane.
 *
 *   heph cross --command "..." --agent X [--host H] [--cosign]
 *        decide (ALLOW/NEEDS_COSIGN/BLOCK) — risk + policy + immune + signed provenance.
 *   heph run --command "..." --agent X [--cosign]     cross THEN execute IF allowed (guarded).
 *   heph polyglot --intent "list listening ports"     translate to THIS OS's shell.
 *   heph policy --set "destructive must co-sign; prod is read-only"   show parsed policy.
 *   heph status                                        crossings + blocked + chain intact.
 */

import { writeSync } from "node:fs";
import * as core from "@mneme-ai/core";

function out(s: string): void { try { writeSync(1, s); } catch { process.stdout.write(s); } }

export interface HephOpts {
  cwd: string; action: string;
  command?: string; agent?: string; host?: string; cosign?: boolean;
  intent?: string; policyText?: string; json?: boolean;
}

export async function hephCommand(o: HephOpts): Promise<number> {
  const h = core.hephaestus;
  const policy = o.policyText ? h.parsePolicy(o.policyText) : undefined;

  if (o.action === "cross" || o.action === "run") {
    if (!o.command || !o.agent) { out("✗ requires --command and --agent\n"); return 2; }
    const r = await h.crossCommand(o.cwd, { command: o.command, agent: o.agent, host: o.host, cosigned: !!o.cosign }, { policy });
    const icon = r.disposition === "ALLOW" ? "🟢" : r.disposition === "NEEDS_COSIGN" ? "🟡" : "🔴";
    if (o.action === "run") {
      const ex = await h.executeGuarded(o.cwd, { command: o.command, agent: o.agent, disposition: r.disposition });
      if (o.json) { out(JSON.stringify({ crossing: r, exec: ex }, null, 2) + "\n"); return ex.ran ? (ex.exitCode ?? 0) : 1; }
      out(`🔨 HEPHAESTUS run — ${icon} ${r.disposition} (${r.risk})\n`);
      for (const x of r.reasons) out(`   • ${x}\n`);
      if (ex.ran) { out(`   ▸ executed (exit ${ex.exitCode})\n`); if (ex.stdout.trim()) out(ex.stdout.trimEnd() + "\n"); if (ex.outputThreats.length) out(`   🛑 output had ${ex.outputThreats.length} injection signature(s) — NOT fed back blindly\n`); }
      else out(`   ▸ NOT executed (${ex.reason})\n`);
      return ex.ran ? (ex.exitCode ?? 0) : 1;
    }
    if (o.json) { out(JSON.stringify(r, null, 2) + "\n"); return r.disposition === "BLOCK" ? 1 : 0; }
    out(`🔨 HEPHAESTUS crossing — ${icon} ${r.disposition} (${r.risk})  ·  by ${r.origin}:${r.agent}${r.host ? ` @ ${r.host}` : ""}\n`);
    for (const x of r.reasons) out(`   • ${x}\n`);
    for (const t of r.threats) out(`   🛑 ${t.kind}: "${t.match}"\n`);
    if (r.tribunal) out(`   ⚖ tribunal: ${r.tribunal.consensus} (${r.tribunal.verdicts.map((v) => `${v.vendor}=${v.verdict}`).join(", ")})\n`);
    out(`   stamp: ${r.receipt ? r.receipt.receiptId.slice(0, 16) + "… (verifies offline)" : "(unsigned)"}\n`);
    return r.disposition === "BLOCK" ? 1 : 0;
  }

  if (o.action === "polyglot") {
    if (!o.intent) { out(`✗ requires --intent. Known: ${h.polyglotIntents().join(" · ")}\n`); return 2; }
    const t = h.polyglot(o.intent);
    if (!t) { out(`✗ unknown intent "${o.intent}". Known: ${h.polyglotIntents().join(" · ")}\n`); return 2; }
    if (o.json) { out(JSON.stringify(t, null, 2) + "\n"); return 0; }
    out(`🌐 ${t.intent}  →  [${t.platform}]  ${t.command}\n`);
    return 0;
  }

  if (o.action === "policy") {
    const p = policy ?? h.DEFAULT_POLICY;
    out(JSON.stringify(p, null, 2) + "\n");
    return 0;
  }

  if (o.action === "status") {
    const s = h.hephaestusStatus(o.cwd);
    if (o.json) { out(JSON.stringify(s, null, 2) + "\n"); return 0; }
    out(`🔨 HEPHAESTUS status\n  crossings: ${s.crossings}  (🟢 ${s.allowed} allowed · 🟡 ${s.needsCosign} need co-sign · 🔴 ${s.blocked} blocked)\n  black box: ${s.chainValid ? "INTACT ✓" : "TAMPERED ✗"}\n`);
    return 0;
  }

  out(`✗ Unknown heph action "${o.action}". Try: cross | run | polyglot | policy | status\n`);
  return 2;
}
