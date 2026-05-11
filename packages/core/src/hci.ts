/**
 * MNEME HCI -- Healthcare Index (v1.27.6).
 *
 * Single 0-100 score that summarizes Mneme's overall health for THIS
 * repo. The user gets ONE number to trust + sub-scores for diagnosis.
 *
 * Like a credit score, but for a repo's wisdom layer:
 *
 *   90-100  Robust    every system green, daemon humming, nothing stale
 *   75-89   Healthy   most green, minor drift in 1-2 axes
 *   50-74   Wobbly    daemon stale OR major axis untriaged
 *   30-49   Sick      multiple FAILs, evolve queue building
 *   0-29    Critical  daemon dead, antivirus uncertified, evolve unproposed
 *
 * Six axes, each 0-100, weighted by user-perceived impact:
 *
 *   - selfcheck         (25%) % of selfcheck verdicts that pass
 *   - daemon            (15%) running + recently ticked
 *   - inbox             (10%) low staleness, no critical unhandled
 *   - antivirus         (15%) vaccines registered + recently certified
 *   - retrieval         (10%) trials > 0
 *   - evolve            (25%) verified patches in chain + low queue
 *
 * The composite stays in [0, 100]. Computed locally in <50ms,
 * deterministic across calls (same disk state -> same score).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface HciAxis {
  name: string;
  /** 0-100 axis score. */
  score: number;
  /** Weight in the composite (0-1). */
  weight: number;
  /** One-line evidence the user can read. */
  evidence: string;
}

export interface HciReport {
  /** Composite 0-100. */
  score: number;
  /** "Robust" | "Healthy" | "Wobbly" | "Sick" | "Critical". */
  band: string;
  /** Per-axis breakdown (sums to score via weights). */
  axes: HciAxis[];
  /** ISO timestamp of computation. */
  computedAt: string;
}

function bandFor(score: number): string {
  if (score >= 90) return "Robust";
  if (score >= 75) return "Healthy";
  if (score >= 50) return "Wobbly";
  if (score >= 30) return "Sick";
  return "Critical";
}

// ─── per-axis scorers ───────────────────────────────────────────────────

function scoreSelfcheck(repoRoot: string): HciAxis {
  const path = join(repoRoot, ".mneme/selfcheck/last.json");
  if (!existsSync(path)) return { name: "selfcheck", score: 30, weight: 0.25, evidence: "no .mneme/selfcheck/last.json" };
  try {
    const r = JSON.parse(readFileSync(path, "utf8")) as { verdicts?: Array<{ status: string }> };
    const v = r.verdicts ?? [];
    if (v.length === 0) return { name: "selfcheck", score: 50, weight: 0.25, evidence: "0 verdicts in last.json" };
    const pass = v.filter((x) => x.status === "pass").length;
    const skip = v.filter((x) => x.status === "skip").length;
    const fail = v.filter((x) => x.status === "fail").length;
    const warn = v.filter((x) => x.status === "warn").length;
    // pass = 100, skip = 70 (neutral), warn = 40, fail = 0
    const sum = pass * 100 + skip * 70 + warn * 40 + fail * 0;
    const score = Math.round(sum / v.length);
    return { name: "selfcheck", score, weight: 0.25, evidence: `${pass} pass, ${skip} skip, ${warn} warn, ${fail} fail (of ${v.length})` };
  } catch {
    return { name: "selfcheck", score: 30, weight: 0.25, evidence: "last.json corrupt" };
  }
}

function scoreDaemon(repoRoot: string): HciAxis {
  const path = join(repoRoot, ".mneme/nucleus.heartbeat.json");
  if (!existsSync(path)) return { name: "daemon", score: 0, weight: 0.15, evidence: "no heartbeat file -- daemon never started" };
  try {
    const hb = JSON.parse(readFileSync(path, "utf8")) as { lastTick?: string; tickCount?: number };
    const ageMs = hb.lastTick ? Date.now() - Date.parse(hb.lastTick) : Infinity;
    if (!Number.isFinite(ageMs)) return { name: "daemon", score: 0, weight: 0.15, evidence: "heartbeat parse fail" };
    if (ageMs < 60_000) return { name: "daemon", score: 100, weight: 0.15, evidence: `last tick ${Math.round(ageMs / 1000)}s ago, ${hb.tickCount ?? 0} ticks` };
    if (ageMs < 5 * 60_000) return { name: "daemon", score: 80, weight: 0.15, evidence: `last tick ${Math.round(ageMs / 1000)}s ago` };
    if (ageMs < 60 * 60_000) return { name: "daemon", score: 30, weight: 0.15, evidence: `last tick ${Math.round(ageMs / 60_000)}m ago -- stale` };
    return { name: "daemon", score: 10, weight: 0.15, evidence: `last tick ${Math.round(ageMs / 3_600_000)}h ago -- dead` };
  } catch {
    return { name: "daemon", score: 0, weight: 0.15, evidence: "heartbeat unreadable" };
  }
}

function scoreInbox(repoRoot: string): HciAxis {
  const path = join(repoRoot, ".mneme/inbox.jsonl");
  if (!existsSync(path)) return { name: "inbox", score: 100, weight: 0.10, evidence: "empty (good)" };
  try {
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    let unsent = 0;
    let criticalUnsent = 0;
    let oldUnsent = 0; // unsent + > 7 days
    const cutoff = Date.now() - 7 * 86_400_000;
    for (const ln of lines) {
      try {
        const e = JSON.parse(ln) as { sent?: boolean; priority?: string; createdAt?: string };
        if (!e.sent) {
          unsent++;
          if (e.priority === "critical") criticalUnsent++;
          if (e.createdAt && Date.parse(e.createdAt) < cutoff) oldUnsent++;
        }
      } catch { /* skip */ }
    }
    if (criticalUnsent > 0) return { name: "inbox", score: 30, weight: 0.10, evidence: `${criticalUnsent} CRITICAL unsent + ${unsent} total unsent` };
    if (oldUnsent > 0) return { name: "inbox", score: 50, weight: 0.10, evidence: `${oldUnsent} unsent older than 7 days` };
    if (unsent > 20) return { name: "inbox", score: 60, weight: 0.10, evidence: `${unsent} unsent (queue building)` };
    if (unsent > 0) return { name: "inbox", score: 85, weight: 0.10, evidence: `${unsent} unsent (normal)` };
    return { name: "inbox", score: 100, weight: 0.10, evidence: "0 unsent (clean)" };
  } catch {
    return { name: "inbox", score: 50, weight: 0.10, evidence: "inbox.jsonl parse fail" };
  }
}

function scoreAntivirus(repoRoot: string): HciAxis {
  const pharm = join(repoRoot, ".mneme/antivirus/pharmacopoeia.json");
  if (!existsSync(pharm)) return { name: "antivirus", score: 30, weight: 0.15, evidence: "no pharmacopoeia.json -- run `mneme antivirus lab`" };
  try {
    const data = JSON.parse(readFileSync(pharm, "utf8")) as { vaccines?: Array<{ efficacy?: { f1?: number | null } | null }> };
    const v = data.vaccines ?? [];
    if (v.length === 0) return { name: "antivirus", score: 30, weight: 0.15, evidence: "0 vaccines registered" };
    const certified = v.filter((x) => x.efficacy?.f1 != null).length;
    const certPct = (certified / v.length) * 100;
    // Recent benchmarks dir age contributes a bonus.
    const benchmarksDir = join(repoRoot, ".mneme/antivirus/benchmarks");
    let recencyBonus = 0;
    try {
      if (existsSync(benchmarksDir)) {
        const ageDays = (Date.now() - statSync(benchmarksDir).mtimeMs) / 86_400_000;
        recencyBonus = ageDays < 7 ? 20 : ageDays < 30 ? 10 : 0;
      }
    } catch { /* */ }
    const score = Math.min(100, Math.round(0.5 * certPct + 30 + recencyBonus));
    return { name: "antivirus", score, weight: 0.15, evidence: `${v.length} vaccines, ${certified} certified${recencyBonus > 0 ? `, recent bench` : ""}` };
  } catch {
    return { name: "antivirus", score: 30, weight: 0.15, evidence: "pharmacopoeia parse fail" };
  }
}

function scoreRetrieval(repoRoot: string): HciAxis {
  const lb = join(repoRoot, ".mneme/retrieval/leaderboard.json");
  if (!existsSync(lb)) return { name: "retrieval", score: 50, weight: 0.10, evidence: "no leaderboard -- not yet tuned" };
  try {
    const data = JSON.parse(readFileSync(lb, "utf8")) as { totalTrials?: number };
    const t = data.totalTrials ?? 0;
    if (t === 0) return { name: "retrieval", score: 60, weight: 0.10, evidence: "0 trials (empty)" };
    if (t < 5) return { name: "retrieval", score: 75, weight: 0.10, evidence: `${t} trials (warming up)` };
    if (t < 20) return { name: "retrieval", score: 90, weight: 0.10, evidence: `${t} trials (converging)` };
    return { name: "retrieval", score: 100, weight: 0.10, evidence: `${t} trials (mature)` };
  } catch {
    return { name: "retrieval", score: 50, weight: 0.10, evidence: "leaderboard parse fail" };
  }
}

function scoreEvolve(repoRoot: string): HciAxis {
  const proposalsDir = join(repoRoot, ".mneme/proposals");
  const lineagePath = join(proposalsDir, "_lineage.jsonl");
  if (!existsSync(proposalsDir)) return { name: "evolve", score: 70, weight: 0.25, evidence: "no proposals yet (calm)" };
  try {
    const fs = readFileSync;
    let proposals = 0, verifiedSynth = 0, applied = 0;
    const files = readdirSync(proposalsDir);
    for (const f of files) {
      if (f.endsWith(".json") && !f.endsWith(".synth.json") && f !== "_lineage.jsonl") proposals++;
      if (f.endsWith(".synth.json")) {
        try {
          const s = JSON.parse(fs(join(proposalsDir, f), "utf8")) as { verified?: boolean };
          if (s.verified) verifiedSynth++;
        } catch { /* skip */ }
      }
    }
    if (existsSync(lineagePath)) {
      try {
        applied = readFileSync(lineagePath, "utf8").trim().split("\n").filter(Boolean).length;
      } catch { /* */ }
    }
    // Score:
    //   no proposals       -> 70 (calm; no work needed yet)
    //   pending unsynthed  -> lower (queue building)
    //   verified untaken   -> higher (low-hanging fruit ready)
    //   applied accumulating -> higher still
    const queueRatio = proposals > 0 ? verifiedSynth / proposals : 1;
    const queueBonus = Math.round(queueRatio * 25);
    const appliedBonus = Math.min(25, applied * 5);
    const score = Math.min(100, 50 + queueBonus + appliedBonus);
    return {
      name: "evolve", score, weight: 0.25,
      evidence: `${proposals} proposals, ${verifiedSynth} verified synth, ${applied} applied`,
    };
  } catch {
    return { name: "evolve", score: 50, weight: 0.25, evidence: "proposals dir scan fail" };
  }
}

// ─── public API ─────────────────────────────────────────────────────────

export function computeHci(repoRoot: string): HciReport {
  const axes: HciAxis[] = [
    scoreSelfcheck(repoRoot),
    scoreDaemon(repoRoot),
    scoreInbox(repoRoot),
    scoreAntivirus(repoRoot),
    scoreRetrieval(repoRoot),
    scoreEvolve(repoRoot),
  ];
  const composite = axes.reduce((acc, a) => acc + a.score * a.weight, 0);
  const score = Math.round(Math.max(0, Math.min(100, composite)));
  return {
    score,
    band: bandFor(score),
    axes,
    computedAt: new Date().toISOString(),
  };
}

/** Render a one-line HCI summary for the pulse. */
export function renderHciLine(report: HciReport): string {
  return `[HCI] ${report.score}/100 (${report.band})  ${report.axes.map((a) => `${a.name}=${a.score}`).join("  ")}`;
}
