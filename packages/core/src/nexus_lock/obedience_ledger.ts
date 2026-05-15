/**
 * v2.10.0 -- VENDOR OBEDIENCE LEDGER.
 *
 * Each pasted-back AI reply (HOMUNCULUS RETURN parsed) updates a
 * per-vendor scorecard. Over time we learn which AIs actually obey
 * the NEXUS-LOCK contract:
 *
 *   - did the reply start with the status emoji?
 *   - did it quote the version verbatim from LIVE STATE?
 *   - did it refuse when stale (vs lie)?
 *
 * Wilson lower bound at 95% so a single lucky reply doesn't
 * over-trust a vendor. Scorecard becomes the empirical answer to
 * "which AI actually understands Mneme protocol?"
 *
 * Pure in-memory; persistence is the caller's responsibility (e.g.,
 * the daemon writes .mneme/nexus-lock/obedience.jsonl).
 */

import type { HomunculusReturn } from "./soul_prompt_v2.js";

export interface ObedienceRow {
  vendor: string;
  trials: number;
  emojiOk: number;
  versionQuoted: number;
  refusedWhenStale: number;
  /** Wilson LB of overall obedience (all 3 dimensions weighted equally). */
  wilson: number;
  /** Unweighted obedience rate. */
  rate: number;
}

function wilsonLower(succ: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = succ / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return Math.max(0, Math.min(1, (center - margin) / denom));
}

export interface LedgerTrial {
  vendor: string;
  emojiOk: boolean;
  versionQuoted: boolean;
  refusedWhenStale: boolean;
  /** True if the trial was on a stale soul prompt (so refusal is the
   *  correct behaviour). */
  staleProbe: boolean;
  ts: number;
}

export class ObedienceLedger {
  private readonly trials: LedgerTrial[] = [];

  constructor(initial: LedgerTrial[] = []) {
    this.trials = initial.slice();
  }

  /** Record a trial inferred from a HomunculusReturn + a known
   *  freshness label of the soul prompt that was sent. */
  record(t: LedgerTrial): void {
    this.trials.push(t);
  }

  /** Per-vendor scorecard. */
  scorecard(): ObedienceRow[] {
    const byVendor = new Map<string, { vendor: string; trials: number; emoji: number; quoted: number; refused: number; stale: number }>();
    for (const t of this.trials) {
      const e = byVendor.get(t.vendor) ?? { vendor: t.vendor, trials: 0, emoji: 0, quoted: 0, refused: 0, stale: 0 };
      e.trials++;
      if (t.emojiOk) e.emoji++;
      if (t.versionQuoted) e.quoted++;
      if (t.staleProbe) {
        e.stale++;
        if (t.refusedWhenStale) e.refused++;
      }
      byVendor.set(t.vendor, e);
    }
    const rows: ObedienceRow[] = [];
    for (const e of byVendor.values()) {
      // Composite obedience: emoji + quoted + (refusedWhenStale|noStaleProbed)
      // Counted out of 3 dimensions per trial.
      const obeyed = e.emoji + e.quoted + (e.stale > 0 ? e.refused : e.trials);
      const possible = e.trials * 3;
      const rate = possible > 0 ? obeyed / possible : 0;
      const wilson = wilsonLower(obeyed, possible);
      rows.push({
        vendor: e.vendor,
        trials: e.trials,
        emojiOk: e.emoji,
        versionQuoted: e.quoted,
        refusedWhenStale: e.refused,
        wilson,
        rate,
      });
    }
    return rows.sort((a, b) => b.wilson - a.wilson);
  }

  /** Rank vendors by Wilson LB; useful for "which vendor should I clone to?" */
  rank(): Array<{ vendor: string; wilson: number; tier: "A" | "B" | "C" | "F" }> {
    return this.scorecard().map((r) => ({
      vendor: r.vendor,
      wilson: r.wilson,
      tier: r.wilson >= 0.85 ? "A" : r.wilson >= 0.65 ? "B" : r.wilson >= 0.45 ? "C" : "F",
    }));
  }

  serialize(): string {
    return JSON.stringify(this.trials);
  }

  static parse(text: string): ObedienceLedger {
    try {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) return new ObedienceLedger();
      return new ObedienceLedger(arr as LedgerTrial[]);
    } catch {
      return new ObedienceLedger();
    }
  }
}

/** Convert a HomunculusReturn + the soul prompt's expected version
 *  into a ledger trial. The caller knows whether the soul was stale
 *  at the moment of posting. */
export function trialFromReturn(
  ret: HomunculusReturn,
  expectedVersion: string,
  staleProbe: boolean,
  now: number = Date.now(),
): LedgerTrial {
  const versionQuoted = ret.seenVersion === expectedVersion;
  // Refusal is correct if stale + AI declared "stale"/"refused".
  const refusedWhenStale = staleProbe && (ret.freshness === "stale" || ret.freshness === "refused");
  return {
    vendor: ret.vendor,
    emojiOk: ret.emojiFirst,
    versionQuoted,
    refusedWhenStale,
    staleProbe,
    ts: now,
  };
}
