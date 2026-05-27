/**
 * 🦠 PROTOPLASM — crawl_planner
 *
 * When system is HEALTHY for N consecutive bursts → trigger crawl_planner.
 * Crawl planner picks topics to research from the function names that are
 * MOST USED in healthy state (= we're confident in those paths, time to
 * explore adjacent ones).
 *
 * Output: CrawlPlan that the orchestrator can hand to MNEMNET / curiosity
 * scanner / external research module.
 */

import type { SuperQuanFinding, CrawlPlan } from "./types.js";

export function planCrawl(recentLedger: SuperQuanFinding[]): CrawlPlan | null {
  const healthy = recentLedger.filter((f) => f.outcome === "healthy");
  if (healthy.length < 10) return null;

  // Count function activity
  const byFn = new Map<string, number>();
  for (const f of healthy) byFn.set(f.fnId, (byFn.get(f.fnId) ?? 0) + 1);
  const top = [...byFn.entries()].sort(([, a], [, b]) => b - a)[0];
  if (!top) return null;
  const [fnId, count] = top;

  // Synthesize topics from the fnId path — packages/core/src/nemesis/classifier.ts → ["nemesis classifier", "agent fingerprinting", "vendor identification"]
  const parts = fnId.split(/[./_]/).filter(Boolean);
  const searchTopics: string[] = [];
  if (parts.includes("nemesis")) searchTopics.push("agent fingerprinting state of art");
  if (parts.includes("argus")) searchTopics.push("multi-modal search Thai-aware NLP");
  if (parts.includes("honest_mirror") || parts.includes("calibration")) searchTopics.push("vendor calibration techniques 2026");
  if (parts.includes("truth_gate")) searchTopics.push("marketing-claim probe binding patterns");
  if (parts.includes("flywheel")) searchTopics.push("self-improving release organ design");
  if (parts.includes("rewind") || parts.includes("reflog")) searchTopics.push("incremental state snapshot algorithms");
  if (searchTopics.length === 0) searchTopics.push(`research adjacent to ${fnId}`);

  const estimatedROI = Math.min(1, count / 100);  // healthier + busier = higher ROI

  return {
    trigger: "healthy-burst",
    fnId,
    searchTopics,
    budgetMs: 30_000,
    estimatedROI,
  };
}
