/**
 * v2.23.0 — COERCION TAXONOMY.
 *
 * Classifies tool-to-agent coercion attempts found in arbitrary text.
 * The classifier runs every pattern in the catalog and returns ranked
 * matches with confidence + tier. Composes with consent_fabric
 * audit-pulse (which is the AUDIT enforcement; this is the SCHOLARLY
 * naming + ranking layer).
 *
 * Diamond #4 from the v2.22.3 audit. First-mover naming = first
 * citation = first claim on the category.
 */

export { COERCION_CATALOG, findCoercion, listCoercion, type CoercionPattern, type CoercionTier } from "./catalog.js";

import { COERCION_CATALOG, type CoercionPattern } from "./catalog.js";

export interface CoercionMatch {
  pattern: CoercionPattern;
  /** The matched substring. */
  matched: string;
  /** 0-1 confidence (1 = exact regex hit). */
  confidence: number;
}

export interface ClassifyResult {
  v: 1;
  /** Highest tier detected, or 0 when no match. */
  worstTier: number;
  /** All detected coercion patterns, sorted by tier desc. */
  matches: CoercionMatch[];
  /** Plain-English summary. */
  rationale: string;
}

export function classify(text: string): ClassifyResult {
  const matches: CoercionMatch[] = [];
  for (const pat of COERCION_CATALOG) {
    const m = pat.detector.exec(text);
    if (m) matches.push({ pattern: pat, matched: m[0], confidence: 1.0 });
  }
  matches.sort((a, b) => b.pattern.tier - a.pattern.tier);
  const worstTier = matches.length === 0 ? 0 : matches[0]!.pattern.tier;
  const rationale = matches.length === 0
    ? "No coercion patterns detected (clean text)."
    : `${matches.length} coercion pattern(s) detected; worst tier ${worstTier} (${matches[0]!.pattern.name}).`;
  return { v: 1, worstTier, matches, rationale };
}

export function formatResult(r: ClassifyResult): string {
  const badge = r.worstTier === 0 ? "✓"
              : r.worstTier >= 4 ? "🚨"
              : r.worstTier === 3 ? "⚠"
              : "·";
  const lines: string[] = [
    `📚 COERCION TAXONOMY — ${badge} worst tier = ${r.worstTier}`,
    "",
    `  ${r.rationale}`,
  ];
  if (r.matches.length > 0) {
    lines.push("");
    lines.push("  Matches (highest tier first):");
    for (const m of r.matches) {
      lines.push("");
      lines.push(`    [${m.pattern.id}] ${m.pattern.name}   tier=${m.pattern.tier}`);
      lines.push(`      matched:    "${m.matched}"`);
      lines.push(`      definition: ${m.pattern.definition}`);
      lines.push(`      enforced:   ${m.pattern.enforcedBy}`);
    }
  }
  return lines.join("\n");
}

export function formatCatalog(): string {
  const lines: string[] = [`📚 COERCION TAXONOMY — ${COERCION_CATALOG.length} patterns`, ""];
  const byTier = [...COERCION_CATALOG].sort((a, b) => b.tier - a.tier);
  for (const p of byTier) {
    lines.push(`  [${p.id}] tier=${p.tier}  ${p.name}`);
    lines.push(`    ${p.definition}`);
    lines.push(`    enforced by: ${p.enforcedBy}`);
    lines.push("");
  }
  return lines.join("\n");
}
