/**
 * Augmentation — the tribal knowledge layer.
 *
 * THIS IS THE MOAT.
 *
 * Pure tools that grep + return file paths exist everywhere. What no other
 * MCP server does:
 *
 *   • Tell the AI which path is CANONICAL (where new code should go)
 *   • Tell the AI which path is DEPRECATED (and cite the commit that
 *     deprecated it, plus the WHY)
 *   • Tell the AI who the EXPERT AUTHOR is (and whether their expertise
 *     is fading via atrophy)
 *   • Tell the AI which past INCIDENTS happened in this code area
 *   • Tell the AI which CONSTITUTION RULES (extracted from regret patterns)
 *     apply to this proposal
 *
 * All of this comes from data Mneme already has — git log, atrophy curves,
 * forensics incidents, decision extraction. We just compose them into a
 * single augmented description that the AI consumes via MCP.
 *
 * This module is INPUT-PURE: it doesn't reach into Mneme's stores directly.
 * It accepts pre-fetched data via the AugmentationInput interface so it
 * stays unit-testable without a real index.
 */

import type { CodeSearchHit } from "./query-engine.js";
import type { Augmentation as AugmentationOptions } from "./pack-schema.js";

// ─── Inputs (caller pre-fetches from Mneme stores) ────────────────────

export interface PathExpertise {
  /** Repo-relative path the expertise applies to. */
  path: string;
  /** Canonical author who knows this area best. */
  expert: string;
  /** Atrophy score (0..100) — higher = expertise fading. */
  atrophyScore: number;
  /** Days since the expert last touched this file. */
  daysSinceLastTouch: number;
}

export interface DeprecationFact {
  /** Path that's deprecated. */
  path: string;
  /** Path the new code should go to (canonical). */
  canonical: string;
  /** Commit that introduced the deprecation. */
  deprecatedInCommit: string;
  /** Reason captured from commit message / decision rule. */
  reason: string;
}

export interface IncidentFact {
  /** Files affected by the incident. */
  affectedPaths: string[];
  /** Short title. */
  title: string;
  /** ISO date when reported. */
  reportedAt: string;
}

export interface ConstitutionRuleFact {
  /** Rule id (e.g. "regret-3"). */
  id: string;
  /** Severity. */
  severity: "must-not" | "must" | "should" | "consider";
  /** The rule text. */
  rule: string;
  /** Source: regret / atrophy / forensics / decision. */
  source: string;
}

export interface AugmentationInput {
  /** Hits returned by the query engine. */
  hits: CodeSearchHit[];
  /** Per-path expertise data (pre-fetched from atrophy + git-blame). */
  expertise: PathExpertise[];
  /** Known deprecation facts (pre-fetched from decision extraction). */
  deprecations: DeprecationFact[];
  /** Past incidents touching paths in `hits`. */
  incidents: IncidentFact[];
  /** Constitution rules that match the hits' paths or content. */
  applicableRules: ConstitutionRuleFact[];
}

// ─── Output ──────────────────────────────────────────────────────────

export interface AugmentedDescription {
  /** Base description from the pack (kept verbatim). */
  base: string;
  /** Augmentation block appended after the base. */
  augmentation: string;
  /** Concatenation of base + "\n\n" + augmentation. */
  full: string;
  /** Structured facts the AI can also consume programmatically. */
  facts: {
    canonicalPath?: string;
    deprecatedPaths: Array<{ path: string; canonical: string; reason: string }>;
    expertAuthors: Array<{ path: string; expert: string; atrophy: number }>;
    incidentSummaries: string[];
    ruleSummaries: string[];
  };
}

// ─── Pure augmentation function ──────────────────────────────────────

/**
 * Compose an augmented description for an MCP tool.
 *
 * Pure function — given identical inputs returns identical output.
 * This is the SHAPE that other MCP servers cannot replicate without
 * indexing the same git/atrophy/forensics/constitution data we do.
 */
export function augmentDescription(
  baseDescription: string,
  options: AugmentationOptions,
  input: AugmentationInput,
): AugmentedDescription {
  const lines: string[] = [];
  const facts: AugmentedDescription["facts"] = {
    deprecatedPaths: [],
    expertAuthors: [],
    incidentSummaries: [],
    ruleSummaries: [],
  };

  // Group hits by path for canonical-path inference
  const hitsByPath = new Map<string, number>();
  for (const h of input.hits) {
    hitsByPath.set(h.path, (hitsByPath.get(h.path) ?? 0) + 1);
  }
  const pathsByHits = Array.from(hitsByPath.entries()).sort((a, b) => b[1] - a[1]);

  // ── Canonical path ────────────────────────────────────────────────
  if (options.includeCanonicalPath && pathsByHits.length > 0) {
    // Path with most hits is treated as canonical, unless it's listed as deprecated
    const deprecatedSet = new Set(input.deprecations.map((d) => d.path));
    const canonical = pathsByHits.find(([path]) => !deprecatedSet.has(path));
    if (canonical) {
      facts.canonicalPath = canonical[0];
      lines.push(`📍 Canonical location: \`${canonical[0]}\` (${canonical[1]} match${canonical[1] === 1 ? "" : "es"})`);
    }
  }

  // ── Deprecated paths ──────────────────────────────────────────────
  if (options.includeDeprecatedPaths && input.deprecations.length > 0) {
    // Only mention deprecations that actually appear in the hits
    const hitPaths = new Set(input.hits.map((h) => h.path));
    for (const dep of input.deprecations) {
      if (!hitPaths.has(dep.path)) continue;
      facts.deprecatedPaths.push({ path: dep.path, canonical: dep.canonical, reason: dep.reason });
      lines.push(
        `❌ Deprecated: \`${dep.path}\` → use \`${dep.canonical}\` instead. ` +
          `Reason: ${dep.reason} (commit ${dep.deprecatedInCommit.slice(0, 8)}).`,
      );
    }
  }

  // ── Expert authors + atrophy ──────────────────────────────────────
  if (options.includeExpertAuthors && input.expertise.length > 0) {
    const hitPaths = new Set(input.hits.map((h) => h.path));
    const relevant = input.expertise.filter((e) => hitPaths.has(e.path));
    // Top 3 by hits-per-path frequency
    const topRelevant = relevant
      .map((e) => ({ ...e, hits: hitsByPath.get(e.path) ?? 0 }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 3);
    for (const e of topRelevant) {
      const status = e.atrophyScore >= 70
        ? `atrophy ${e.atrophyScore}/100 — expertise fading, pair before changing`
        : e.atrophyScore >= 40
        ? `atrophy ${e.atrophyScore}/100 — review with this person`
        : `current expert (atrophy ${e.atrophyScore}/100)`;
      facts.expertAuthors.push({ path: e.path, expert: e.expert, atrophy: e.atrophyScore });
      lines.push(`👤 ${e.expert} owns \`${e.path}\` — ${status}.`);
    }
  }

  // ── Recent incidents ──────────────────────────────────────────────
  if (options.includeRecentIncidents && input.incidents.length > 0) {
    const hitPaths = new Set(input.hits.map((h) => h.path));
    const relevant = input.incidents.filter((i) =>
      i.affectedPaths.some((p) => hitPaths.has(p)),
    );
    for (const inc of relevant.slice(0, 3)) {
      const summary = `${inc.title} (${inc.reportedAt.slice(0, 10)})`;
      facts.incidentSummaries.push(summary);
      lines.push(`🚨 Past incident in this area: ${summary}.`);
    }
  }

  // ── Applicable constitution rules ─────────────────────────────────
  if (options.includeApplicableRules && input.applicableRules.length > 0) {
    for (const r of input.applicableRules.slice(0, 5)) {
      const tag =
        r.severity === "must-not" ? "❌ MUST NOT" :
        r.severity === "must" ? "✅ MUST" :
        r.severity === "should" ? "▸ SHOULD" : "○ CONSIDER";
      const summary = `${tag}: ${truncate(r.rule, 100)}`;
      facts.ruleSummaries.push(summary);
      lines.push(`📜 Constitution rule [${r.id}]: ${summary}`);
    }
  }

  const augmentation = lines.length > 0
    ? "\n\n— Tribal knowledge from this repo's history —\n" + lines.join("\n")
    : "";
  const full = baseDescription + augmentation;

  return { base: baseDescription, augmentation, full, facts };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

/** Empty input — for tools where Mneme's index is not yet built. */
export const EMPTY_AUGMENTATION_INPUT: AugmentationInput = {
  hits: [],
  expertise: [],
  deprecations: [],
  incidents: [],
  applicableRules: [],
};
