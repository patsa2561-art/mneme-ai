/**
 * v1.65.0 -- POWER 7 SHADOW TREASURY.
 *
 * Per the user mandate "free-first, default to free", we cannot
 * report dollar revenue. But we CAN report value-created. This
 * module computes two honest non-dollar treasury axes:
 *
 *   1. Token-Saved Shadow Treasury -- USD equivalent of tokens the
 *      reactor ledger SAVED, at industry-standard rates ($0.003/1K
 *      input tokens, $0.015/1K output tokens). Converted to
 *      "SaaS-months saved" using a $8/mo reference cost.
 *
 *   2. Community Gravity -- federation peers + cross-project
 *      imports + mesh-seen instances. Proxy for sustainability
 *      without revenue.
 *
 * Inputs are pulled live from the existing reactor ledger + mesh
 * artifacts on disk -- no hard-coded numbers.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface ShadowTreasury {
  /** Total tokens saved across all reactor layers, lifetime. */
  tokensSavedLifetime: number;
  /** Equivalent USD value at $0.003 per 1K tokens (input rate, conservative). */
  shadowUsdSaved: number;
  /** Months of equivalent SaaS subscription saved (at $8/mo reference). */
  saasMonthsSaved: number;
  /** Federation peers detected via mesh gossip + replicating-wisdom transfer. */
  federationPeers: number;
  /** Cross-project vaccine imports (peers that fed us vaccines). */
  crossProjectImports: number;
  /** Composite sustainability score 0..1. */
  sustainabilityScore: number;
  /** Plain-English headline. */
  headline: string;
}

const SAAS_REFERENCE_USD_PER_MONTH = 8;
const USD_PER_1K_TOKENS = 0.003;

interface ReactorRow {
  tokensSpent?: number;
  baselineTokens?: number;
  tokensSaved?: number;
  ts?: string;
}

function readReactorLedger(repoRoot: string): ReactorRow[] {
  // Reactor writes to .mneme/reactor/ledger.jsonl per session.
  const ledger = join(repoRoot, ".mneme/reactor/ledger.jsonl");
  if (!existsSync(ledger)) return [];
  try {
    return readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as ReactorRow; } catch { return null; }
    }).filter((x): x is ReactorRow => x !== null);
  } catch { return []; }
}

function countMeshSeen(repoRoot: string): number {
  const p = join(repoRoot, ".mneme/mesh-seen.jsonl");
  if (!existsSync(p)) return 0;
  try {
    const seen = new Set<string>();
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line) as { peer?: string; from?: string; instanceId?: string };
        const id = j.peer ?? j.from ?? j.instanceId;
        if (id) seen.add(id);
      } catch { /* */ }
    }
    return seen.size;
  } catch { return 0; }
}

function countWisdomImports(repoRoot: string): number {
  const dir = join(repoRoot, ".mneme/wisdom-packs");
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((e) => e.endsWith(".mwt") || e.endsWith(".json")).length;
  } catch { return 0; }
}

export function shadowTreasury(repoRoot: string): ShadowTreasury {
  const rows = readReactorLedger(repoRoot);
  let tokensSavedLifetime = 0;
  for (const r of rows) {
    const explicit = typeof r.tokensSaved === "number" ? r.tokensSaved : null;
    if (explicit !== null && explicit >= 0) {
      tokensSavedLifetime += explicit;
      continue;
    }
    const spent = typeof r.tokensSpent === "number" ? r.tokensSpent : 0;
    const baseline = typeof r.baselineTokens === "number" ? r.baselineTokens : 0;
    if (baseline > spent) tokensSavedLifetime += baseline - spent;
  }
  const shadowUsdSaved = tokensSavedLifetime / 1000 * USD_PER_1K_TOKENS;
  const saasMonthsSaved = shadowUsdSaved / SAAS_REFERENCE_USD_PER_MONTH;
  const federationPeers = countMeshSeen(repoRoot);
  const crossProjectImports = countWisdomImports(repoRoot);
  // Composite: log-scaled saas-months + peer count + imports.
  const sustainabilityScore = Math.min(1,
    Math.log10(1 + saasMonthsSaved) * 0.4 +
    Math.log10(1 + federationPeers) * 0.4 +
    Math.log10(1 + crossProjectImports) * 0.2,
  );

  const headline = (saasMonthsSaved > 0 || federationPeers > 0 || crossProjectImports > 0)
    ? `Saved $${shadowUsdSaved.toFixed(4)} (= ${saasMonthsSaved.toFixed(4)} SaaS-months); ${federationPeers} federation peers; ${crossProjectImports} wisdom imports.`
    : `No reactor savings or federation peers logged yet.`;

  return {
    tokensSavedLifetime,
    shadowUsdSaved,
    saasMonthsSaved,
    federationPeers,
    crossProjectImports,
    sustainabilityScore,
    headline,
  };
}
