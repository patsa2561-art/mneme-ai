/**
 * v2.81.0 — `mneme creditscore <action>` (alias `trustscore`) · portable AI honesty credit score.
 *
 * Distinct from `mneme honesty` (which mints static HMAC SVG badge certs from the
 * pulse ledger). This is the PORTABLE, Ed25519-signed, cross-agent honesty CREDIT
 * SCORE an agent checks before delegating to another agent (💎5, on the NOTARY spine).
 *
 *   mneme creditscore score --agent A --true N --false M [--partial P] [--sign] [--ttl-days D]
 *   mneme creditscore verify <file|-> [--min GOLD] [--issuer FP]
 */

import { writeSync, readFileSync } from "node:fs";
import * as core from "@mneme-ai/core";

function out(s: string): void {
  try { writeSync(1, s); } catch { process.stdout.write(s); }
}

const BANDS = new Set(["PLATINUM", "GOLD", "SILVER", "BRONZE", "UNTRUSTED", "UNMEASURED"]);

export interface CreditScoreOpts {
  cwd: string;
  action: string;
  agent?: string;
  trueCount?: number;
  falseCount?: number;
  partialCount?: number;
  sign?: boolean;
  ttlDays?: number;
  file?: string;
  min?: string;
  issuer?: string;
  json?: boolean;
}

export async function creditScoreCommand(o: CreditScoreOpts): Promise<number> {
  const h = core.honestyScore;

  if (o.action === "score") {
    if (!o.agent) { out("✗ score requires --agent\n"); return 2; }
    const score = h.computeHonestyScore({
      agent: o.agent,
      trueCount: o.trueCount ?? 0,
      falseCount: o.falseCount ?? 0,
      partialCount: o.partialCount ?? 0,
    });
    if (o.sign) {
      out(JSON.stringify(h.issueHonestyReceipt(o.cwd, score, { ttlDays: o.ttlDays }), null, 2) + "\n");
      return 0;
    }
    if (o.json) { out(JSON.stringify(score, null, 2) + "\n"); return 0; }
    out(`📊 HONESTY CREDIT SCORE — ${score.agent}\n  score: ${score.score}/100  ·  band: ${score.band}\n  verified: ${score.trueCount} true / ${score.falseCount} false${score.partialCount ? ` / ${score.partialCount} partial` : ""}  (decisive ${score.decisive})\n  Wilson-LB: ${(score.wilsonLB * 100).toFixed(1)}% (pessimistic — small samples score low by design)\n  Add --sign to emit a portable, offline-verifiable receipt.\n`);
    return 0;
  }

  if (o.action === "verify") {
    let raw: string;
    try { raw = o.file && o.file !== "-" ? readFileSync(o.file, "utf8") : readFileSync(0, "utf8"); }
    catch (e) { out(`✗ cannot read receipt: ${(e as Error).message}\n`); return 2; }
    let receipt: unknown;
    try { receipt = JSON.parse(raw); } catch { out("✗ receipt is not valid JSON\n"); return 2; }
    const minBand = o.min && BANDS.has(o.min) ? o.min as core.honestyScore.HonestyBand : "SILVER";
    const v = h.verifyHonestyReceipt(receipt);
    const trust = h.shouldTrust(receipt, minBand, { expectedIssuerFingerprint: o.issuer });
    if (o.json) { out(JSON.stringify({ verify: v, trust }, null, 2) + "\n"); return v.valid && trust.trust ? 0 : 1; }
    if (!v.valid) { out(`🔴 INVALID — ${v.reason}\n`); return 1; }
    const mark = trust.trust ? "🟢" : "🟡";
    out(`${mark} ${v.score!.agent}: score ${v.score!.score}/100 (${v.score!.band})${v.expired ? " ⏰ EXPIRED" : ""}\n  issuer: ${v.issuerFingerprint}\n  trust ≥ ${minBand}? ${trust.trust ? "YES" : "NO"} — ${trust.reason}\n`);
    return trust.trust ? 0 : 1;
  }

  out(`✗ Unknown creditscore action "${o.action}". Try: score | verify\n`);
  return 2;
}
