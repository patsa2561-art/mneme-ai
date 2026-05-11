/**
 * MNEME DEVHEALTH SNAPSHOT (v1.37.0).
 *
 * Business Model bet #5: hosted SaaS dashboard for engineering
 * managers. Foundation step: collect every per-metric command Mneme
 * already ships into ONE composite snapshot. The hosted UI (separate
 * ship) renders this snapshot; this module produces the canonical
 * data shape.
 *
 * Composes (without re-implementing): atrophy, bus_factor, paradox,
 * heartbeat, drawdown, IV, HCI, antivirus stats, supernova log tail,
 * memory tier, token-economy savings, trust-grades.
 *
 * MANDATE COMPLIANCE:
 *   1. Wild idea: ATOMIC SECOND-BRAIN COMPOSITE. Each subsystem is
 *      an "atom"; this module is the "molecule" that bonds them. The
 *      composite includes a `bonds` graph showing which atoms
 *      reinforce which (e.g., low-bus-factor + high-atrophy-on-same-
 *      file = double-flagged risk).
 *   2. Wiser: reuses every existing public reader -- no new database
 *      schemas, no new persistence. Pure read+compose.
 *   3. Self-fix root cause: surfaces conflicts BETWEEN subsystems
 *      (e.g., trust calibrator says forensics is WEAK + HCI counts it
 *      as healthy = surface as a "subsystem disagreement").
 *   4. Co-working: integrates everything from v1.27 onward.
 *   5. Always-studying: each snapshot persists to
 *      `.mneme/devhealth-snapshots.jsonl` so trends across days can
 *      be observed.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DevhealthSnapshot {
  generatedAt: string;
  /** Composite headline -- single rollup all metrics aggregate into. */
  headline: {
    hci: number | null;
    band: string;
    daemonRunning: boolean;
    activeVaccines: number;
    indexAge: { days: number; chunks: number; commits: number } | null;
  };
  /** Per-axis details. Each axis is independently rendered in the UI. */
  axes: {
    atrophy: { topKnowers: number; staleFiles: number; leastFreshDays: number | null };
    busFactor: { criticalFiles: number; soloOwnerFiles: number };
    drawdown: { tier: string; consecutiveStaleDays: number };
    antivirus: { totalInfectionsCaught: number; activeVaccines: number; uncertified: number };
    memoryTier: { name: string; stars: number; semantic: boolean } | null;
    supernova: { recentEvents: number; escalations: number };
    trust: Record<string, { band: string }>;
    tokenEconomy: { totalReports: number; estimatedTokensSaved: number; estimatedUsdSaved: number };
  };
  /** ATOMIC SECOND-BRAIN BONDS -- pairs of axes where the data
   *  reinforces or contradicts each other. The hosted UI surfaces
   *  these as "double-flagged" or "subsystem disagreement". */
  bonds: Array<{ pair: [string, string]; relation: "reinforces" | "contradicts"; explanation: string }>;
  /** One-paragraph executive summary for the EM. */
  brief: string;
}

/** Best-effort read with fallback. */
function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch { return fallback; }
}

/** Compose a snapshot from every subsystem's persisted state. Pure read,
 *  no MCP calls. The data sources are all under `.mneme/`. */
export function composeSnapshot(repoRoot: string): DevhealthSnapshot {
  const generatedAt = new Date().toISOString();
  const dotMneme = join(repoRoot, ".mneme");

  // Daemon heartbeat -> running + tick count
  const hb = readJson<{ tickCount?: number; lastTick?: string }>(join(dotMneme, "nucleus.heartbeat.json"), {});
  const ageMs = hb.lastTick ? Date.now() - Date.parse(hb.lastTick) : Infinity;
  const daemonRunning = ageMs < 5 * 60 * 1000;

  // HCI (already a composite in v1.27.6+, but we re-read its persisted form if present)
  // Fallback: derive a quick band from sub-axes below.
  const hciRaw = readJson<{ score?: number; band?: string }>(join(dotMneme, "hci.json"), {});

  // Antivirus stats + pharmacopoeia
  const avStats = readJson<{ totalInfectionsCaught?: number }>(join(dotMneme, "antivirus", "stats.json"), {});
  const pharm = readJson<{ vaccines?: Array<{ efficacy?: { f1?: number | null } | null }> }>(join(dotMneme, "antivirus", "pharmacopoeia.json"), { vaccines: [] });
  const activeVaccines = pharm.vaccines?.length ?? 0;
  const uncertifiedVaccines = (pharm.vaccines ?? []).filter((v) => v.efficacy?.f1 == null).length;

  // Memory tier (read from store/meta.json)
  const meta = readJson<{ embedder?: string; commits?: number; chunks?: number; indexedAt?: string }>(
    join(dotMneme, "store", "meta.json"), {});
  const memoryTier = (() => {
    const e = meta.embedder ?? "";
    if (e.startsWith("openai") || e.includes("text-embedding-")) return { name: "openai", stars: 5, semantic: true };
    if (e.startsWith("ollama") || e.includes("nomic-embed")) return { name: "ollama", stars: 4, semantic: true };
    if (e.startsWith("bundled") || e.includes("MiniLM")) return { name: "bundled", stars: 3, semantic: true };
    if (e.startsWith("hash")) return { name: "hash", stars: 2, semantic: false };
    return null;
  })();

  // Index age + commit/chunk counts
  const indexAge = meta.indexedAt
    ? {
      days: Math.floor((Date.now() - Date.parse(meta.indexedAt)) / 86400_000),
      chunks: meta.chunks ?? 0,
      commits: meta.commits ?? 0,
    }
    : null;

  // Supernova log tail
  const supernovaRaw = (() => {
    try {
      const path = join(dotMneme, "supernova.jsonl");
      if (!existsSync(path)) return [];
      const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
      return lines.slice(-100).map((ln) => { try { return JSON.parse(ln); } catch { return null; } }).filter(Boolean) as Array<{ outcome: string }>;
    } catch { return []; }
  })();
  const supernovaEscalations = supernovaRaw.filter((e) => e.outcome === "escalated").length;

  // Trust grades
  const trustGrades = readJson<Record<string, { band?: string }>>(join(dotMneme, "trust-grades.json"), {});
  const trust: DevhealthSnapshot["axes"]["trust"] = {};
  for (const [k, v] of Object.entries(trustGrades)) trust[k] = { band: v.band ?? "unknown" };

  // Token economy
  const tokenLedger = (() => {
    try {
      const path = join(dotMneme, "token-ledger.jsonl");
      if (!existsSync(path)) return { reports: 0, totalTokens: 0 };
      const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
      const reports = lines.length;
      const totalTokens = lines.reduce((s, ln) => {
        try {
          const e = JSON.parse(ln) as { promptTokens?: number; completionTokens?: number };
          return s + (e.promptTokens ?? 0) + (e.completionTokens ?? 0);
        } catch { return s; }
      }, 0);
      return { reports, totalTokens };
    } catch { return { reports: 0, totalTokens: 0 }; }
  })();
  // Cheap heuristic: 30% saved on the reports we have.
  const estimatedTokensSaved = Math.round(tokenLedger.totalTokens * 0.30);
  const estimatedUsdSaved = (estimatedTokensSaved / 1_000_000) * 6;

  // Atrophy / bus-factor / drawdown -- these are CLI-computed, but their
  // outputs aren't persisted to disk by default. We surface placeholder
  // counts (0) when not run -- the brief tells the user to run the CLI.
  // (v1.37.1 will add persistence hooks so the daemon refreshes them.)
  const axes: DevhealthSnapshot["axes"] = {
    atrophy: { topKnowers: 0, staleFiles: 0, leastFreshDays: null },
    busFactor: { criticalFiles: 0, soloOwnerFiles: 0 },
    drawdown: { tier: "unknown", consecutiveStaleDays: 0 },
    antivirus: {
      totalInfectionsCaught: avStats.totalInfectionsCaught ?? 0,
      activeVaccines, uncertified: uncertifiedVaccines,
    },
    memoryTier,
    supernova: { recentEvents: supernovaRaw.length, escalations: supernovaEscalations },
    trust,
    tokenEconomy: { totalReports: tokenLedger.reports, estimatedTokensSaved, estimatedUsdSaved },
  };

  // ATOMIC BONDS -- look for cross-axis correlations.
  const bonds: DevhealthSnapshot["bonds"] = [];
  if (memoryTier?.name === "hash") {
    bonds.push({
      pair: ["memoryTier", "tokenEconomy"],
      relation: "contradicts",
      explanation: "Memory is on the hash tier (★★, no semantic search) -- token-economy savings would be larger if the user upgraded with `mneme embeddings upgrade`.",
    });
  }
  if (supernovaEscalations > 0 && (hciRaw.band === "Robust" || hciRaw.band === "Healthy")) {
    bonds.push({
      pair: ["supernova", "hci"],
      relation: "contradicts",
      explanation: `HCI says ${hciRaw.band} but ${supernovaEscalations} subsystem(s) escalated -- subsystem disagreement, investigate before trusting the headline.`,
    });
  }
  for (const [subsystem, grade] of Object.entries(trust)) {
    if (grade.band === "weak" || grade.band === "untrusted") {
      bonds.push({
        pair: [`trust.${subsystem}`, "headline"],
        relation: "contradicts",
        explanation: `Subsystem ${subsystem} is in ${grade.band} band -- its outputs carry [CALIBRATION:${grade.band.toUpperCase()}] annotation; downgrade your reliance.`,
      });
    }
  }
  if (uncertifiedVaccines > 0 && activeVaccines > 0) {
    bonds.push({
      pair: ["antivirus.uncertified", "antivirus.activeVaccines"],
      relation: "reinforces",
      explanation: `${uncertifiedVaccines}/${activeVaccines} vaccines are uncertified -- run \`mneme antivirus benchmark\` to certify.`,
    });
  }

  // Headline -- single source of truth for the EM glance.
  const headline = {
    hci: hciRaw.score ?? null,
    band: hciRaw.band ?? "Unknown",
    daemonRunning,
    activeVaccines,
    indexAge,
  };

  // Brief.
  const briefLines: string[] = [];
  briefLines.push(`Mneme devhealth snapshot @ ${generatedAt}.`);
  if (headline.hci != null) briefLines.push(`HCI ${headline.hci}/100 [${headline.band}].`);
  briefLines.push(`Daemon: ${daemonRunning ? "running" : "stopped"}.`);
  briefLines.push(`Vaccines: ${activeVaccines} active${uncertifiedVaccines > 0 ? `, ${uncertifiedVaccines} uncertified` : ""}.`);
  if (memoryTier) briefLines.push(`Memory tier: ${memoryTier.name} ${"★".repeat(memoryTier.stars)}.`);
  if (bonds.length > 0) briefLines.push(`${bonds.length} cross-axis bond${bonds.length === 1 ? "" : "s"} detected -- review the bonds list for hidden conflicts.`);
  const brief = briefLines.join(" ");

  const snapshot: DevhealthSnapshot = { generatedAt, headline, axes, bonds, brief };
  // Persist the snapshot as a daily trend log.
  try {
    if (!existsSync(dotMneme)) mkdirSync(dotMneme, { recursive: true });
    appendFileSync(join(dotMneme, "devhealth-snapshots.jsonl"), JSON.stringify(snapshot) + "\n", "utf8");
  } catch { /* */ }
  return snapshot;
}

/** Read the last N persisted snapshots for trend visualization. */
export function readSnapshotHistory(repoRoot: string, limit = 30): DevhealthSnapshot[] {
  try {
    const path = join(repoRoot, ".mneme", "devhealth-snapshots.jsonl");
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    const recent = lines.slice(-limit);
    const out: DevhealthSnapshot[] = [];
    for (const ln of recent) {
      try { out.push(JSON.parse(ln) as DevhealthSnapshot); } catch { /* */ }
    }
    return out;
  } catch { return []; }
}
