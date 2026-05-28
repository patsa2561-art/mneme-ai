/**
 * v2.80.0 — `mneme flight <action>` · the AI black box.
 *
 *   mneme flight record --agent A --action "..." [--kind K] [--reasoning R] [--claim C] [--reality O] [--delta MATCH|CONTRADICT|UNVERIFIED]
 *   mneme flight replay            — causal-order narrative + the incident moment
 *   mneme flight verify            — verify the whole recorder offline (public-key)
 *   mneme flight seal              — emit ONE court-admissible signed receipt
 */

import { writeSync } from "node:fs";
import * as core from "@mneme-ai/core";

function out(s: string): void {
  try { writeSync(1, s); } catch { process.stdout.write(s); }
}

const KINDS = new Set(["action", "decision", "claim", "tool-call", "payment", "observation"]);
const DELTAS = new Set(["MATCH", "CONTRADICT", "UNVERIFIED"]);

export interface FlightOpts {
  cwd: string;
  action: string;
  agent?: string;
  frameKind?: string;
  actionText?: string;
  reasoning?: string;
  claim?: string;
  reality?: string;
  delta?: string;
  json?: boolean;
}

export async function flightCommand(o: FlightOpts): Promise<number> {
  const fr = core.flightRecorder;

  if (o.action === "record") {
    if (!o.agent || !o.actionText) { out("✗ record requires --agent and --action\n"); return 2; }
    const f = fr.record(o.cwd, {
      agent: o.agent,
      kind: o.frameKind && KINDS.has(o.frameKind) ? o.frameKind as core.flightRecorder.FrameKind : "action",
      action: o.actionText,
      reasoning: o.reasoning,
      claim: o.claim,
      observedReality: o.reality,
      truthDelta: o.delta && DELTAS.has(o.delta) ? o.delta as core.flightRecorder.TruthDelta : undefined,
    });
    if (o.json) { out(JSON.stringify(f, null, 2) + "\n"); return 0; }
    const mark = f.truthDelta === "CONTRADICT" ? "🔴" : f.truthDelta === "MATCH" ? "🟢" : "⚪";
    out(`🛫 recorded frame #${f.seq} ${mark} (${f.truthDelta}) — receipt ${f.receiptId.slice(0, 12)}…\n`);
    return 0;
  }

  if (o.action === "verify") {
    const v = fr.verifyCdr(o.cwd, { sameIssuer: true });
    if (o.json) { out(JSON.stringify(v, null, 2) + "\n"); return v.valid ? 0 : 1; }
    out(v.valid ? `🟢 BLACK BOX INTACT — ${v.frames} frame(s) verify offline (signed + chained).\n` : `🔴 TAMPERED — ${v.reason} (at frame ${v.brokenAt}).\n`);
    return v.valid ? 0 : 1;
  }

  if (o.action === "replay") {
    const r = fr.replay(o.cwd);
    if (o.json) { out(JSON.stringify(r, null, 2) + "\n"); return 0; }
    const lines: string[] = [];
    lines.push(`🎞  FLIGHT REPLAY — ${r.frames} frame(s) · chain ${r.chainValid ? "VALID ✓" : "BROKEN ✗"}`);
    lines.push(`   match=${r.counts.match} contradict=${r.counts.contradict} unverified=${r.counts.unverified}`);
    if (r.incidentSeq !== null) lines.push(`   🔴 INCIDENT at frame #${r.incidentSeq} (first claim≠reality)`);
    lines.push("");
    for (const n of r.narrative) lines.push(`   ${n}`);
    out(lines.join("\n") + "\n");
    return 0;
  }

  if (o.action === "seal") {
    const s = fr.seal(o.cwd);
    if (o.json) { out(JSON.stringify(s, null, 2) + "\n"); return 0; }
    out(`🔏 SEALED — ${s.frames} frame(s), ${s.contradictions} contradiction(s)${s.incidentSeq !== null ? ` (incident #${s.incidentSeq})` : ""}.\n  head:    ${s.head ?? "(empty)"}\n  receipt: ${s.receipt.receiptId}\n  issuer:  ${s.receipt.issuerFingerprint}\n\n  Hand the receipt to an auditor — it verifies offline (mneme notary verify).\n`);
    return 0;
  }

  out(`✗ Unknown flight action "${o.action}". Try: record | replay | verify | seal\n`);
  return 2;
}
