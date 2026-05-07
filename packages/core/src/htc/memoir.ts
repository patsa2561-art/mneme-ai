/**
 * HTC Layer 3 — repo memoir.
 *
 * Single-shot LLM call that turns all cluster summaries into a ~500-token
 * narrative covering: what the repo IS, the major topics + their evolution,
 * and current state + open questions.
 *
 * This is the topmost layer of the cache: 50,000 commits → 500 tokens. The
 * caller pays this cost ONCE per generation; every downstream `mneme ask`
 * can reuse it forever.
 */
import type { ClusterSummary, HtcEnricher, Memoir } from "./types.js";
import { estimateTokens } from "./types.js";

export const MEMOIR_SYSTEM_PROMPT =
  "Write a ~500-token narrative summary of a codebase based on its topic " +
  "clusters. Output structure:\n" +
  "  1. One opening paragraph: what this repo IS.\n" +
  "  2. 3-5 bullet paragraphs: each major topic + its evolution.\n" +
  "  3. One closing: current state + open questions.\n" +
  "Be specific, concrete, dated where possible. No buzzwords.";

export interface ClusterDateRange {
  /** Optional ISO date of the cluster's earliest commit (YYYY-MM-DD ok). */
  fromDate?: string;
  /** Optional ISO date of the cluster's latest commit. */
  toDate?: string;
}

/**
 * Build the user-side prompt block. Clusters should be passed in the order
 * the caller wants them rendered (typically chronological by fromDate).
 */
export function buildMemoirUserPrompt(
  clusters: Array<ClusterSummary & ClusterDateRange>,
): string {
  const lines = ["Topic clusters in chronological order:"];
  for (const c of clusters) {
    const dateRange =
      c.fromDate && c.toDate
        ? ` (${c.memberHashes.length} commits, dates ${c.fromDate} to ${c.toDate})`
        : ` (${c.memberHashes.length} commits)`;
    lines.push("");
    lines.push(`  CLUSTER "${c.label}"${dateRange}:`);
    lines.push(`    ${c.summary}`);
  }
  return lines.join("\n");
}

/** Generate the single-shot repo memoir from cluster summaries. */
export async function generateMemoir(
  clusters: Array<ClusterSummary & ClusterDateRange>,
  totalCommits: number,
  enricher: HtcEnricher,
): Promise<Memoir> {
  if (clusters.length === 0) {
    throw new Error("Cannot generate memoir from zero clusters; run Layer 2 first.");
  }
  const start = Date.now();
  const result = await enricher.enrich({
    system: MEMOIR_SYSTEM_PROMPT,
    user: buildMemoirUserPrompt(clusters),
    // ~500 tokens target; 800 cap leaves room without inviting tangents.
    maxTokens: 800,
    // Slightly higher than Layer 1/2 — narrative needs a bit of voice.
    temperature: 0.4,
  });
  const generationMs = Date.now() - start;
  const narrative = (result.text ?? "").trim();
  return {
    narrative,
    totalCommits,
    totalClusters: clusters.length,
    tokenCount: estimateTokens(narrative),
    generationMs,
    generator: enricher.name,
    generatedAt: new Date().toISOString(),
  };
}
