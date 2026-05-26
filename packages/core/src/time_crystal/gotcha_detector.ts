/**
 * v2.63.0 — TIME-CRYSTAL gotcha detector.
 *
 * When an approach has MIXED outcomes (worked for some agents, failed
 * for others), the failure-environment pattern is signal: there exists
 * a CONDITION under which the approach breaks. Surface that.
 *
 * Algorithm:
 *  1. For each approach group with ≥1 success AND ≥1 failure,
 *     compute the env keys / values that appear MORE OFTEN in
 *     failures than successes (information gain).
 *  2. Emit gotcha rows: { approach, triggerConditions, severity }.
 *  3. Also fold any explicit free-text notes that contain "fail" /
 *     "break" / "ไม่ work" / "พัง" / "doesn't" keywords.
 */

import type { WisdomRecord } from "./ranking.js";

export interface Gotcha {
  approach: string;
  /** Env conditions where this approach has elevated failure risk. */
  triggerConditions: Array<{ key: string; value: string; failRateGain: number }>;
  /** 0..1 severity score (higher = more reliable failure pattern). */
  severity: number;
  /** Free-text notes from contributors. */
  notes: string[];
}

const FAILURE_WORDS = /\b(fail|fails|failed|fails?|break|breaks?|broke|doesn'?t|don'?t work|พัง|ใช้ไม่ได้|ไม่ work)\b/i;

export function detectGotchas(records: WisdomRecord[]): Gotcha[] {
  const byApproach = new Map<string, WisdomRecord[]>();
  for (const r of records) {
    const k = r.approach.replace(/\s+/g, " ").trim().toLowerCase();
    const list = byApproach.get(k) ?? [];
    list.push(r);
    byApproach.set(k, list);
  }

  const gotchas: Gotcha[] = [];
  for (const [key, list] of byApproach.entries()) {
    const successes = list.filter((r) => r.outcome === "success");
    const failures = list.filter((r) => r.outcome === "failure");
    if (failures.length === 0) continue; // no signal
    if (successes.length === 0 && failures.length < 3) continue; // too few to call it a pattern

    // Compute per-(key,value) failure-rate gain.
    const envKeys = new Set<string>();
    for (const r of [...successes, ...failures]) for (const k of Object.keys(r.env ?? {})) envKeys.add(k);

    const triggers: Gotcha["triggerConditions"] = [];
    for (const k of envKeys) {
      const valuesSeen = new Set<string>();
      for (const r of [...successes, ...failures]) {
        const v = r.env?.[k];
        if (v) valuesSeen.add(v);
      }
      for (const v of valuesSeen) {
        const failCountWithV = failures.filter((r) => r.env?.[k] === v).length;
        const succCountWithV = successes.filter((r) => r.env?.[k] === v).length;
        const totalWithV = failCountWithV + succCountWithV;
        if (totalWithV < 2) continue;
        const failRate = failCountWithV / totalWithV;
        const overallFailRate = failures.length / (failures.length + successes.length);
        const gain = failRate - overallFailRate;
        if (gain >= 0.30 && failRate >= 0.50) {
          triggers.push({ key: k, value: v, failRateGain: +gain.toFixed(3) });
        }
      }
    }

    // Aggregate explicit notes that look like failure descriptions.
    const notes: string[] = [];
    for (const r of list) {
      if (r.note && FAILURE_WORDS.test(r.note)) {
        const norm = r.note.trim();
        if (norm.length > 0 && !notes.includes(norm)) notes.push(norm);
      }
    }
    if (triggers.length === 0 && notes.length === 0) continue;

    const severity = Math.min(1, 0.4 + triggers.length * 0.15 + notes.length * 0.10 + (failures.length / Math.max(1, list.length)) * 0.30);
    gotchas.push({
      approach: list[0]!.approach, // representative casing
      triggerConditions: triggers.sort((a, b) => b.failRateGain - a.failRateGain).slice(0, 5),
      severity: +severity.toFixed(3),
      notes: notes.slice(0, 5),
    });
  }
  return gotchas.sort((a, b) => b.severity - a.severity);
}
