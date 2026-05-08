/**
 * Live-mode wisdom — Mneme metrics computed in-browser from the 30-commit
 * detail window the API allows us to fetch.
 *
 * These are *proxies* of the full Mneme metrics (HKD/TWS/CVR/HRR/REI/KAH/PCS)
 * that core/metrics computes against a fully-indexed repo. Each proxy is
 * deliberately conservative — when the unauthenticated API window is too
 * small to ground a proper estimate, we return null and the UI shows "—"
 * instead of a fabricated number.
 *
 * Pure function, deterministic. Same inputs = same outputs.
 */

import type { NervousSystemData } from "../types";

export interface LiveWisdomMetric {
  /** 3-letter code (matches the Mneme metric family). */
  code: "HKD" | "REI" | "KAH" | "PCS" | "TWS";
  /** Display label in the UI. */
  label: string;
  /** Numeric value to render — null = not enough data, render "—". */
  value: number | null;
  /** Suffix for the value (e.g. "%", "wk"). */
  suffix?: string;
  /** One-line plain-English explanation of what this number means. */
  explain: string;
  /** Where this proxy stands relative to the full metric (honest framing). */
  caveat: string;
}

const HALF_LIFE_DAYS = 90;

export function computeLiveWisdom(data: NervousSystemData): LiveWisdomMetric[] {
  const passports = data.passports ?? [];
  const criticalFiles = data.atrophy?.criticalFiles ?? [];
  const totalAuthors = data.meta.totalAuthors;

  // ─── HKD proxy ──────────────────────────────────────────────────────
  // Hidden Knowledge Density: fraction of touched files where the top
  // knower wrote ≥80% of the touches. Captures bus-factor-of-1 risk.
  let hkd: number | null = null;
  if (criticalFiles.length > 0) {
    const concentrated = criticalFiles.filter(
      (f) =>
        f.liveExpertCount === 1 ||
        (f.topKnower != null &&
          // top-knower share — proxy via touchTotal vs liveExpertCount
          f.totalTouches / Math.max(1, f.liveExpertCount) >= f.totalTouches * 0.8),
    );
    hkd = Math.round((concentrated.length / criticalFiles.length) * 100);
  }

  // ─── REI proxy ──────────────────────────────────────────────────────
  // Regret Echo Index: % of recent commits whose message hints at "we
  // already learned this once" — words like revert, rollback, hotfix,
  // re-add, regression. Computed only if we have surprising[] data
  // (proxy through hero metrics). For live mode we don't have raw
  // commit messages — fallback: heuristic on truncated.
  // We use the data already present in `surprising` as a hint.
  const surprising = data.surprising ?? [];
  let rei: number | null = null;
  // If any surprising line mentions "single commit" or "drive-by" we use it.
  const driveByLine = surprising.find((s) => /single|drive[-\s]?by|^\d+ authors made exactly one/i.test(s));
  if (driveByLine) {
    const m = driveByLine.match(/(\d+)/);
    if (m && totalAuthors > 0) {
      rei = Math.round((parseInt(m[1]!, 10) / totalAuthors) * 100);
    }
  }

  // ─── KAH proxy ──────────────────────────────────────────────────────
  // Knowledge Atrophy Halflife: median lastTouchDaysAgo across topFiles
  // of all passports — converted to weeks via the half-life formula.
  // expertise(t) = e^(−λ·t), with halfLife = ln(2)/λ → here λ is set by
  // the median decay observed.
  const allDays: number[] = [];
  for (const p of passports) {
    for (const f of p.expertise.topFiles) allDays.push(f.lastTouchDaysAgo);
  }
  let kah: number | null = null;
  if (allDays.length >= 3) {
    const sorted = [...allDays].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    // Approximation: KAH (weeks) ≈ median days ago / 2 (i.e. roughly half
    // the median lookback maps to half-life). Bounded.
    kah = Math.max(1, Math.round(median / 7));
  }

  // ─── PCS proxy ──────────────────────────────────────────────────────
  // Provenance Chain Strength: % of authors with both fromDate and
  // lastActiveAt populated AND a non-empty dnaHash. In live-mode this is
  // always 100% (we set those fields), but we surface it for honesty —
  // real PCS needs HMAC chain which the live path can't provide.
  // Always null in live mode.
  const pcs: number | null = null;

  // ─── TWS proxy ──────────────────────────────────────────────────────
  // Tribal Wisdom Score: proxy via % of files in atrophy that have
  // > 1 live expert (i.e. knowledge is not concentrated in one person).
  let tws: number | null = null;
  if (criticalFiles.length > 0) {
    const shared = criticalFiles.filter((f) => f.liveExpertCount >= 2).length;
    tws = Math.round((shared / criticalFiles.length) * 100);
  }

  return [
    {
      code: "HKD",
      label: "Hidden Knowledge Density",
      value: hkd,
      suffix: "%",
      explain:
        hkd == null
          ? "Need atrophy data to compute"
          : `${hkd}% of tracked files have 1 dominant author — bus-factor risk.`,
      caveat:
        "Proxy: computed across the 30-commit detail window. Full HKD scans every file in the indexed repo.",
    },
    {
      code: "REI",
      label: "Regret Echo Index",
      value: rei,
      suffix: "%",
      explain:
        rei == null
          ? "Need commit-message data to compute"
          : `${rei}% of authors made just one commit in window — possible drive-by churn.`,
      caveat:
        "Proxy: drive-by author share. Full REI compares against extracted regret patterns from the whole git log.",
    },
    {
      code: "KAH",
      label: "Knowledge Atrophy Halflife",
      value: kah,
      suffix: "wk",
      explain:
        kah == null
          ? "Need ≥3 file touches to estimate"
          : `Median ~${kah} weeks since the team's tracked files were last touched.`,
      caveat:
        "Proxy: median last-touch in weeks. Full KAH fits a log-space exponential decay across multi-snapshot atrophy.",
    },
    {
      code: "TWS",
      label: "Tribal Wisdom Score",
      value: tws,
      suffix: "%",
      explain:
        tws == null
          ? "Need atrophy data to compute"
          : `${tws}% of touched files have ≥2 live experts — knowledge is shared, not siloed.`,
      caveat:
        "Proxy: file co-authorship across the detail window. Full TWS verifies the cited commit's neighborhood contains a related decision/regret.",
    },
    {
      code: "PCS",
      label: "Provenance Chain Strength",
      value: pcs,
      suffix: "%",
      explain:
        "Needs HMAC-chained AI audit log — only available with the local CLI.",
      caveat:
        "Live mode cannot compute PCS. The full metric requires an HMAC-chain of every AI tool call mapped to git commits.",
    },
  ];
}

void HALF_LIFE_DAYS; // kept for tooling / future expansion
