/**
 * v1.73.0 -- GENESPLICE G2: GENOME RECOMBINATION.
 *
 * Take N capsules from N different vendors. Merge them into a single
 * SUPER-GENOME that's smarter than any individual vendor history.
 *
 * Algorithm (CRDT-ish):
 *   1. Concatenate decisions; dedup by lowercase prefix-similarity
 *   2. Merge promptTrace by timestamp (chronological order across vendors)
 *   3. Reasoning trace: union, attribute each step to its source vendor
 *   4. ContextSummary: weighted concat (each vendor gets equal share)
 *   5. New superGenome.originVendor = "hybrid:A+B+C"
 *
 * This is the "genetic engineering" the user asked for: gene-splicing
 * AI brains across vendors so the result inherits each vendor's
 * strengths.
 */

import { createHash } from "node:crypto";
import type { SessionCapsule, CapsulePromptStep } from "../diaspora/session_capsule.js";

export interface RecombineInput {
  capsules: SessionCapsule[];
  /** How many recent turns to keep per vendor in the hybrid trace. */
  turnsPerVendor?: number;
  /** Cluster secret for verifying source capsules' HMAC (best-effort). */
  verifySecret?: string;
}

export interface HybridCapsule {
  id: string;
  hybridVersion: 1;
  /** Source vendor list. */
  sources: Array<{ vendor: string; capsuleId: string }>;
  createdAt: string;
  contextSummary: string;
  decisions: string[];
  promptTrace: Array<CapsulePromptStep & { sourceVendor: string }>;
  reasoningTrace: Array<{ text: string; sourceVendor: string }>;
  /** Number of agreement votes per fact (Chromosomal Crossover; G4). */
  agreementMap: Record<string, { vendors: string[]; count: number }>;
  /** Plain-English headline. */
  headline: string;
}

function tokenize(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 3));
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function dedupSimilar(items: Array<{ text: string; vendor: string }>, threshold = 0.6): Array<{ text: string; vendors: string[]; count: number }> {
  const groups: Array<{ text: string; tokens: Set<string>; vendors: string[]; count: number }> = [];
  for (const item of items) {
    const tokens = tokenize(item.text);
    const match = groups.find((g) => jaccardSim(g.tokens, tokens) >= threshold);
    if (match) {
      if (!match.vendors.includes(item.vendor)) match.vendors.push(item.vendor);
      match.count += 1;
    } else {
      groups.push({ text: item.text, tokens, vendors: [item.vendor], count: 1 });
    }
  }
  return groups.map(({ text, vendors, count }) => ({ text, vendors, count }));
}

export function recombineGenome(input: RecombineInput): HybridCapsule {
  const { capsules } = input;
  const turnsPerVendor = input.turnsPerVendor ?? 5;
  if (capsules.length === 0) {
    return {
      id: "empty",
      hybridVersion: 1,
      sources: [], createdAt: new Date().toISOString(),
      contextSummary: "", decisions: [], promptTrace: [], reasoningTrace: [],
      agreementMap: {},
      headline: "No source capsules to recombine.",
    };
  }
  const sources = capsules.map((c) => ({ vendor: c.originVendor, capsuleId: c.id }));

  // 1. ContextSummary: equal-share concat.
  const ctxParts: string[] = [];
  for (const c of capsules) {
    ctxParts.push(`[${c.originVendor}]: ${c.contextSummary}`);
  }
  const contextSummary = ctxParts.join("\n\n");

  // 2. Decisions: dedup similar entries, keep agreement counts.
  const allDecisionItems: Array<{ text: string; vendor: string }> = [];
  for (const c of capsules) {
    for (const d of c.decisions ?? []) allDecisionItems.push({ text: d, vendor: c.originVendor });
  }
  const dedupedDecisions = dedupSimilar(allDecisionItems);
  const decisions = dedupedDecisions.map((d) =>
    d.vendors.length > 1
      ? `${d.text} (${d.vendors.length} vendors: ${d.vendors.join(", ")})`
      : `${d.text} (${d.vendors[0]})`,
  );
  const agreementMap: HybridCapsule["agreementMap"] = {};
  for (const d of dedupedDecisions) {
    agreementMap[d.text.slice(0, 60)] = { vendors: d.vendors, count: d.count };
  }

  // 3. PromptTrace: chronological merge, last N per vendor.
  const tracePerVendor = new Map<string, Array<CapsulePromptStep & { sourceVendor: string }>>();
  for (const c of capsules) {
    tracePerVendor.set(c.originVendor, c.promptTrace.slice(-turnsPerVendor).map((s) => ({ ...s, sourceVendor: c.originVendor })));
  }
  const mergedTrace = [...tracePerVendor.values()].flat().sort((a, b) => a.ts.localeCompare(b.ts));

  // 4. Reasoning trace: union, attribute.
  const reasoning: HybridCapsule["reasoningTrace"] = [];
  for (const c of capsules) {
    for (const r of c.reasoningTrace ?? []) reasoning.push({ text: r, sourceVendor: c.originVendor });
  }

  const ts = new Date().toISOString();
  const hybridId = createHash("sha256")
    .update(sources.map((s) => s.capsuleId).join("|"))
    .update(ts)
    .digest("hex").slice(0, 16);

  const headline = `Hybrid genome from ${sources.length} vendor(s): ${sources.map((s) => s.vendor).join(" + ")}. ${decisions.length} decision(s), ${mergedTrace.length} turn(s).`;

  return {
    id: hybridId,
    hybridVersion: 1,
    sources,
    createdAt: ts,
    contextSummary,
    decisions,
    promptTrace: mergedTrace,
    reasoningTrace: reasoning,
    agreementMap,
    headline,
  };
}

/** Find decisions that ONLY one vendor made (unique-to-vendor wisdom).
 *  Useful for "what does Claude see that Gemini missed?" */
export function uniqueWisdom(hybrid: HybridCapsule): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [decision, agreement] of Object.entries(hybrid.agreementMap)) {
    if (agreement.vendors.length === 1) {
      const v = agreement.vendors[0]!;
      if (!out[v]) out[v] = [];
      out[v]!.push(decision);
    }
  }
  return out;
}

/** Find decisions where MULTIPLE vendors agreed (high-trust facts). */
export function consensusWisdom(hybrid: HybridCapsule): Array<{ decision: string; vendors: string[] }> {
  const out: Array<{ decision: string; vendors: string[] }> = [];
  for (const [decision, agreement] of Object.entries(hybrid.agreementMap)) {
    if (agreement.vendors.length >= 2) out.push({ decision, vendors: agreement.vendors });
  }
  return out;
}
