/**
 * 💥 3. ELON-CLAIMS-AS-CHRONOSTASIS
 *
 * Track public Elon utterances as pending claims with deadline + HMAC.
 * Grade them automatically against measurable metrics.
 *
 * Composes existing Mneme Chronostasis but adds:
 *   - source provenance (twitter / interview / earnings_call / ...)
 *   - utterance URL for citation
 *   - asserted-metric extraction (numeric claim + comparison op + deadline)
 *   - public scorecard rendering
 */

import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ElonChronostasisClaim } from "./types.js";

export interface RecordClaimInput {
  text: string;
  source: ElonChronostasisClaim["source"];
  utteranceUrl?: string;
  asserted: ElonChronostasisClaim["asserted"];
  deadlineIso: string;
}

export interface GradeInput {
  claimId: string;
  measuredValue: number;
  evidence?: string;
}

export class ElonChronostasis {
  constructor(private ledgerPath: string, private hmacKey: string) {
    mkdirSync(dirname(ledgerPath), { recursive: true });
  }

  private allRows(): ElonChronostasisClaim[] {
    if (!existsSync(this.ledgerPath)) return [];
    return readFileSync(this.ledgerPath, "utf8").trim().split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as ElonChronostasisClaim; } catch { return null; }
    }).filter((x): x is ElonChronostasisClaim => x !== null);
  }

  record(input: RecordClaimInput): ElonChronostasisClaim {
    const id = createHmac("sha256", this.hmacKey).update(input.text + input.deadlineIso).digest("hex").slice(0, 12);
    const body: Omit<ElonChronostasisClaim, "hmac"> = {
      id,
      source: input.source,
      utteranceUrl: input.utteranceUrl,
      text: input.text,
      asserted: input.asserted,
      deadlineIso: input.deadlineIso,
      status: "pending",
    };
    const hmac = createHmac("sha256", this.hmacKey).update(JSON.stringify(body)).digest("hex").slice(0, 16);
    const claim: ElonChronostasisClaim = { ...body, hmac };
    appendFileSync(this.ledgerPath, JSON.stringify(claim) + "\n");
    return claim;
  }

  /** Grade a single claim with a measured value. Returns final status. */
  grade(input: GradeInput): { ok: boolean; status: ElonChronostasisClaim["status"]; reason: string } {
    const rows = this.allRows();
    const claim = rows.find((r) => r.id === input.claimId);
    if (!claim) return { ok: false, status: "expired", reason: "claim not found" };
    if (Date.now() < new Date(claim.deadlineIso).getTime()) {
      return { ok: false, status: "pending", reason: "deadline not reached yet" };
    }
    const { value, op } = claim.asserted;
    const v = input.measuredValue;
    let confirmed = false;
    switch (op) {
      case ">": confirmed = v > value; break;
      case "<": confirmed = v < value; break;
      case "=": confirmed = Math.abs(v - value) < 0.001; break;
      case "≥": confirmed = v >= value; break;
      case "≤": confirmed = v <= value; break;
    }
    const finalStatus: ElonChronostasisClaim["status"] = confirmed ? "confirmed" : "refuted";
    const updated: ElonChronostasisClaim = {
      ...claim,
      status: finalStatus,
      evidence: input.evidence ?? `measured ${v} vs asserted ${op}${value}`,
    };
    appendFileSync(this.ledgerPath, JSON.stringify({ ...updated, _kind: "grade_update" }) + "\n");
    return { ok: true, status: finalStatus, reason: updated.evidence! };
  }

  /** Scorecard: count by status + per-source totals. */
  scorecard(): {
    total: number;
    pending: number;
    confirmed: number;
    refuted: number;
    expired: number;
    bySource: Record<string, { total: number; confirmed: number; refuted: number }>;
    hitRate: number;
  } {
    const rows = this.allRows();
    // Use latest status per id (later rows override on grade_update)
    const latest = new Map<string, ElonChronostasisClaim>();
    for (const r of rows) latest.set(r.id, r);
    const all = [...latest.values()];

    const out = { total: all.length, pending: 0, confirmed: 0, refuted: 0, expired: 0,
      bySource: {} as Record<string, { total: number; confirmed: number; refuted: number }>,
      hitRate: 0 };
    for (const c of all) {
      out[c.status]++;
      const s = c.source;
      if (!out.bySource[s]) out.bySource[s] = { total: 0, confirmed: 0, refuted: 0 };
      out.bySource[s].total++;
      if (c.status === "confirmed") out.bySource[s].confirmed++;
      if (c.status === "refuted") out.bySource[s].refuted++;
    }
    const graded = out.confirmed + out.refuted;
    out.hitRate = graded > 0 ? out.confirmed / graded : 0;
    return out;
  }
}
