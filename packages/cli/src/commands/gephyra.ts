/**
 * v2.83.0 — `mneme gephyra <action>` · the Toll Booth of Truth.
 *
 *   mneme gephyra cross --claim "..." --from AGENT [--to AGENT] [--action A]
 *        route a claim through the bridge: truth-customs (real ACGV) + immune +
 *        honesty toll + conscience + signed crossing stamp.
 *   mneme gephyra status   — live: crossings, hallucinations caught, chain intact
 *   mneme gephyra log      — replay the crossing black box
 */

import { writeSync } from "node:fs";
import * as core from "@mneme-ai/core";

function out(s: string): void { try { writeSync(1, s); } catch { process.stdout.write(s); } }

export interface GephyraOpts {
  cwd: string; action: string;
  claim?: string; from?: string; to?: string; frameAction?: string; json?: boolean;
}

export async function gephyraCommand(o: GephyraOpts): Promise<number> {
  const g = core.gephyra;

  if (o.action === "cross") {
    if (!o.claim || !o.from) { out("✗ cross requires --claim and --from\n"); return 2; }
    const r = await g.crossBridge(o.cwd, { claim: o.claim, fromAgent: o.from, toAgent: o.to, action: o.frameAction }, {
      verify: g.apoptosisTruthCustoms(o.cwd),
    });
    if (o.json) { out(JSON.stringify(r, null, 2) + "\n"); return r.disposition === "QUARANTINED" ? 1 : 0; }
    const icon = r.disposition === "PASS" ? "🟢" : r.disposition === "CORRECTED" ? "🟠" : r.disposition === "QUARANTINED" ? "🔴" : "⚪";
    out(`🌉 GEPHYRA crossing — ${icon} ${r.disposition} (${r.verdict})\n`);
    out(`  from: ${r.fromAgent}${r.toAgent ? ` → ${r.toAgent}` : ""}  ·  honesty: ${r.honestyBand}  ·  scrutiny: ${r.scrutiny}\n`);
    if (r.deliveredClaim !== r.claim) out(`  delivered (corrected): ${r.deliveredClaim || "(blocked)"}\n`);
    if (r.evidence) out(`  evidence: ${r.evidence}\n`);
    for (const t of r.threats) out(`  🛑 threat: ${t.kind} — "${t.match}"\n`);
    for (const n of r.nudges) out(`  💡 nudge → ${r.fromAgent}: ${n}\n`);
    if (r.degraded.length) out(`  ⚠ degraded: ${r.degraded.join(", ")}\n`);
    out(`  stamp: ${r.receipt ? r.receipt.receiptId.slice(0, 16) + "… (verifies offline)" : "(unsigned — recorder failed)"}\n`);
    return r.disposition === "QUARANTINED" ? 1 : 0;
  }

  if (o.action === "status") {
    const s = g.bridgeStatus(o.cwd);
    if (o.json) { out(JSON.stringify(s, null, 2) + "\n"); return 0; }
    out(`🌉 GEPHYRA status\n  crossings: ${s.crossings}  (🟢 ${s.passed} pass · 🟠 ${s.corrected} corrected · 🔴 ${s.quarantined} quarantined · ⚪ ${s.unverified} unverified)\n  hallucinations / threats caught: ${s.hallucinationsCaught}\n  black box: ${s.chainValid ? "INTACT ✓" : "TAMPERED ✗"}\n`);
    return 0;
  }

  if (o.action === "log") {
    const rep = g.bridgeReplay(o.cwd);
    if (o.json) { out(JSON.stringify(rep, null, 2) + "\n"); return 0; }
    out(`🎞 GEPHYRA crossing log — ${rep.frames} frame(s), chain ${rep.chainValid ? "VALID ✓" : "BROKEN ✗"}\n`);
    for (const n of rep.narrative) out(`  ${n}\n`);
    return 0;
  }

  out(`✗ Unknown gephyra action "${o.action}". Try: cross | status | log\n`);
  return 2;
}
