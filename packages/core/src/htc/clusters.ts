/**
 * HTC Layer 2 — topic cluster summaries.
 *
 * Takes pre-built clusters (from insights/cluster.buildClusters) plus the
 * cached Layer-1 abstracts and asks the enricher to roll each cluster up
 * into a ~100-token paragraph: topic + major changes + sequence.
 *
 * The cluster's `label` is extracted from the LLM's output (first sentence
 * heuristic). We never invent labels — if the model produces nothing
 * usable, we fall back to "cluster <id>".
 */
import type { ClusterSummary, HtcEnricher } from "./types.js";
import { estimateTokens } from "./types.js";

export const CLUSTER_SYSTEM_PROMPT =
  "Summarize a group of related git commits into ~100 tokens. Output a brief " +
  "paragraph that names the topic, lists the major changes, and notes any " +
  "sequence (e.g. \"started with X, evolved to Y\").";

export interface ClusterInput {
  /** Stable cluster identifier; persisted as cluster_id. */
  id: string;
  memberHashes: string[];
}

export interface GenerateClusterSummariesOptions {
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  onError?: (clusterId: string, err: string) => void;
}

export function buildClusterUserPrompt(abstracts: string[]): string {
  const lines = ["Commit abstracts (one per line):"];
  for (const a of abstracts) {
    const trimmed = a.trim();
    if (trimmed) lines.push(`  - ${trimmed}`);
  }
  return lines.join("\n");
}

/**
 * Extract a short topic label from the LLM's summary. Heuristic: take the
 * first colon-prefixed phrase ("auth: …") OR the first 4 words of the first
 * sentence. Caps at ~40 chars. Never invents — falls back to caller-provided
 * fallback when the summary is empty.
 */
export function extractLabel(summary: string, fallback: string): string {
  const trimmed = summary.trim();
  if (!trimmed) return fallback;
  // Pattern A: "topic: rest of sentence"
  const colonMatch = trimmed.match(/^([A-Za-z0-9 _\-/.]{2,40}?):/);
  if (colonMatch) return colonMatch[1]!.trim().toLowerCase();
  // Pattern B: first sentence, first 4 words.
  const firstSentence = trimmed.split(/[.!?\n]/)[0]!.trim();
  const words = firstSentence.split(/\s+/).slice(0, 4).join(" ");
  return (words || fallback).slice(0, 40).toLowerCase();
}

export async function generateClusterSummary(
  cluster: ClusterInput,
  abstracts: Map<string, string>,
  enricher: HtcEnricher,
): Promise<ClusterSummary> {
  // Pull the abstracts for this cluster's members. Missing ones are skipped
  // (caller should ensure Layer 1 was generated; we don't refuse, but a
  // cluster with zero abstracts can't be summarized usefully).
  const memberAbstracts: string[] = [];
  for (const hash of cluster.memberHashes) {
    const a = abstracts.get(hash);
    if (a) memberAbstracts.push(a);
  }
  if (memberAbstracts.length === 0) {
    throw new Error(
      `Cluster ${cluster.id} has no Layer-1 abstracts available; generate abstracts first.`,
    );
  }

  const start = Date.now();
  const result = await enricher.enrich({
    system: CLUSTER_SYSTEM_PROMPT,
    user: buildClusterUserPrompt(memberAbstracts),
    // ~100 tokens target → 200 cap leaves room without inviting essays.
    maxTokens: 200,
    temperature: 0.3,
  });
  const generationMs = Date.now() - start;
  const summary = (result.text ?? "").trim();
  const label = extractLabel(summary, `cluster ${cluster.id}`);
  return {
    clusterId: cluster.id,
    label,
    summary,
    memberHashes: cluster.memberHashes,
    tokenCount: estimateTokens(summary),
    generationMs,
    generator: enricher.name,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Batch summary generation with bounded concurrency. Failures recorded via
 * onError; the surviving results are returned.
 */
export async function generateClusterSummaries(
  abstracts: Map<string, string>,
  clusters: ClusterInput[],
  enricher: HtcEnricher,
  opts: GenerateClusterSummariesOptions = {},
): Promise<ClusterSummary[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const out: ClusterSummary[] = [];
  let done = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= clusters.length) return;
      const c = clusters[i]!;
      try {
        const s = await generateClusterSummary(c, abstracts, enricher);
        out.push(s);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        opts.onError?.(c.id, msg);
      } finally {
        done++;
        opts.onProgress?.(done, clusters.length);
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return out;
}
