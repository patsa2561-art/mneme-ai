/**
 * 🦠 PROTOPLASM — orchestrator
 *
 * Central brain that:
 *   - receives findings via PROBE_LISTENERS
 *   - dispatches to wisdom_space when broken
 *   - triggers crawl_planner when healthy bursts accumulate
 *
 * Stateless w.r.t. file IO — all chain writes are via findings_ledger.
 */

import type { SuperQuanFinding, WisdomRootCause, CrawlPlan, ProtoplasmConfig } from "./types.js";
import { onFinding } from "./super_quan_probe.js";
import { diagnose, ledgerHealth } from "./wisdom_space.js";
import { planCrawl } from "./crawl_planner.js";
import { readLedger, appendFinding } from "./findings_ledger.js";

export interface OrchestratorVerdict {
  finding: SuperQuanFinding;
  diagnosis?: WisdomRootCause;
  crawl?: CrawlPlan;
}

export interface OrchestratorHooks {
  onBroken?: (v: OrchestratorVerdict) => void;
  onCrawl?: (v: OrchestratorVerdict) => void;
  onHealthy?: (v: OrchestratorVerdict) => void;
}

const DEFAULT_CFG: ProtoplasmConfig = {
  baselineSamplesMin: 5,
  zScoreWarn: 2,
  zScoreBroken: 3,
  ledgerDir: ".mneme/protoplasm",
  hmacKey: process.env.MNEME_PROTOPLASM_KEY ?? "dev-protoplasm-key",
  crawlOnHealthyEvery: 50,
};

let healthyBurstCount = 0;
let activeHooks: OrchestratorHooks = {};

export function startOrchestrator(hooks: OrchestratorHooks = {}, cfg: ProtoplasmConfig = DEFAULT_CFG): () => void {
  activeHooks = hooks;
  const stop = onFinding((finding) => {
    handle(finding, cfg);
  });
  return stop;
}

function handle(finding: SuperQuanFinding, cfg: ProtoplasmConfig): OrchestratorVerdict {
  const verdict: OrchestratorVerdict = { finding };
  if (finding.outcome === "broken") {
    const recent = readLedger(cfg.ledgerDir + "/findings.jsonl").slice(-200);
    verdict.diagnosis = diagnose({ brokenFinding: finding, recentLedger: recent });
    healthyBurstCount = 0;
    activeHooks.onBroken?.(verdict);
  } else if (finding.outcome === "healthy") {
    healthyBurstCount++;
    activeHooks.onHealthy?.(verdict);
    if (healthyBurstCount >= cfg.crawlOnHealthyEvery) {
      healthyBurstCount = 0;
      const recent = readLedger(cfg.ledgerDir + "/findings.jsonl").slice(-200);
      const crawl = planCrawl(recent);
      if (crawl) { verdict.crawl = crawl; activeHooks.onCrawl?.(verdict); }
    }
  }
  return verdict;
}

export function manualProbeReport(cfg: ProtoplasmConfig = DEFAULT_CFG): { health: ReturnType<typeof ledgerHealth>; lastFindings: SuperQuanFinding[] } {
  const recent = readLedger(cfg.ledgerDir + "/findings.jsonl").slice(-100);
  return { health: ledgerHealth(recent), lastFindings: recent.slice(-10) };
}

export const DEFAULT_PROTOPLASM_CONFIG = DEFAULT_CFG;
