/**
 * v2.4.0 -- SYMBIOSIS · PER-VENDOR SUCCESS LEDGER.
 *
 * After Mneme phrases an intent in vendor-preferred shape (via INTENT
 * SHAPER) and ships it, the receiving AI either DOES the right thing
 * (called the right tool, produced the right answer) or DOESN'T. The
 * ledger records the outcome. Over time we learn which intent shapes
 * actually work for each vendor — and reinforce the winners.
 *
 * Pure in-memory store with optional caller-supplied persistence. The
 * caller (CLI / daemon) decides where to keep the ledger on disk so
 * SYMBIOSIS itself remains free of filesystem coupling.
 */

export type IntentOutcome = "succeeded" | "wrong-tool" | "no-call" | "refused";

export interface IntentTrial {
  vendor: string;
  tool: string;
  shape: string;
  outcome: IntentOutcome;
  ts: number;
}

export interface IntentStat {
  vendor: string;
  tool: string;
  trials: number;
  succeeded: number;
  rate: number;
  /** Wilson lower bound of success rate at 95% conf — a calibrated estimate
   *  that doesn't over-trust a single lucky trial. */
  wilson: number;
}

/** Wilson lower bound of a binary success rate at 95% confidence. */
function wilsonLower(succ: number, total: number): number {
  if (total === 0) return 0;
  const z = 1.96;
  const p = succ / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return Math.max(0, Math.min(1, (center - margin) / denom));
}

export class IntentLedger {
  private readonly trials: IntentTrial[] = [];

  constructor(initial: IntentTrial[] = []) {
    this.trials = initial.slice();
  }

  record(trial: IntentTrial): void {
    this.trials.push(trial);
  }

  /** All trials, newest first. */
  list(): IntentTrial[] {
    return this.trials.slice().reverse();
  }

  /** Aggregate trials per (vendor, tool) pair. */
  stats(): IntentStat[] {
    const map = new Map<string, { vendor: string; tool: string; trials: number; succeeded: number }>();
    for (const t of this.trials) {
      const k = `${t.vendor}::${t.tool}`;
      const e = map.get(k) ?? { vendor: t.vendor, tool: t.tool, trials: 0, succeeded: 0 };
      e.trials++;
      if (t.outcome === "succeeded") e.succeeded++;
      map.set(k, e);
    }
    return Array.from(map.values()).map((e) => ({
      ...e,
      rate: e.trials > 0 ? e.succeeded / e.trials : 0,
      wilson: wilsonLower(e.succeeded, e.trials),
    }));
  }

  /** Per-vendor recommendation: which tools have the highest Wilson LB. */
  recommendTools(vendor: string, topK = 5): IntentStat[] {
    return this.stats()
      .filter((s) => s.vendor === vendor)
      .sort((a, b) => b.wilson - a.wilson)
      .slice(0, topK);
  }

  /** Cross-vendor lift: which tool benefits most from per-vendor shaping. */
  shapingLift(): Array<{ tool: string; bestVendor: string; worstVendor: string; lift: number }> {
    const byTool = new Map<string, IntentStat[]>();
    for (const s of this.stats()) {
      (byTool.get(s.tool) ?? byTool.set(s.tool, []).get(s.tool)!).push(s);
    }
    const out: Array<{ tool: string; bestVendor: string; worstVendor: string; lift: number }> = [];
    for (const [tool, stats] of byTool.entries()) {
      if (stats.length < 2) continue;
      const sorted = stats.slice().sort((a, b) => b.wilson - a.wilson);
      const best = sorted[0]!;
      const worst = sorted[sorted.length - 1]!;
      out.push({ tool, bestVendor: best.vendor, worstVendor: worst.vendor, lift: best.wilson - worst.wilson });
    }
    return out.sort((a, b) => b.lift - a.lift);
  }

  /** Serialize for persistence. */
  serialize(): string {
    return JSON.stringify(this.trials);
  }

  /** Parse a previously-serialized ledger. */
  static parse(text: string): IntentLedger {
    try {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) return new IntentLedger();
      return new IntentLedger(arr as IntentTrial[]);
    } catch {
      return new IntentLedger();
    }
  }
}
