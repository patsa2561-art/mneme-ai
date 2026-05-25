/**
 * v2.46.0 — NEMESIS ORGAN 2 base: CLASSIFIER.
 *
 * Vendor-fingerprint scoring based on the importance weights documented
 * in arxiv 2601.17406 (Jan 2026):
 *
 *   Codex:        multiline commits (67.5%)
 *   Claude Code:  conditional statements distinct (27.2%)
 *   Copilot:      long PR descriptions (38.4%) + change concentration (24.9%)
 *   Cursor:       bullet points (17.2%) + hyperlinks (12.8%)
 *   Devin:        multiline (48.9%) + distributed changes (8.2%)
 *
 * The CLASSIFIER applies these weights to the extracted Fingerprint and
 * returns the most-likely VendorId + per-vendor scores + confidence.
 *
 * Pure deterministic — no ML model needed; the paper's coefficients ARE
 * the model.
 */

import type { Fingerprint, AgentVerdict, VendorId } from "./types.js";

interface SignalWeight {
  feature: keyof Fingerprint;
  /** Multiplier; the feature value is multiplied by this and summed. */
  weight: number;
  /** Anti-feature: subtract instead of add (penalise wrong shape). */
  antiFeature?: boolean;
}

interface VendorSignature {
  vendor: VendorId;
  signals: SignalWeight[];
}

/**
 * Each vendor's signature is a small set of (feature × weight) terms.
 * The weights come from the arxiv paper's per-vendor feature importance
 * + cross-vendor anti-features so each fixture goes to ONE clear winner.
 */
const SIGNATURES: VendorSignature[] = [
  {
    vendor: "codex",
    signals: [
      { feature: "multiline_commit_ratio", weight: 0.675 },
      { feature: "mean_commit_lines", weight: 0.10 },
      { feature: "commit_bullet_count", weight: 0.08 },
      // Codex doesn't load PR with bullets / hyperlinks
      { feature: "bullet_point_count", weight: 0.15, antiFeature: true },
      { feature: "hyperlink_count", weight: 0.15, antiFeature: true },
      { feature: "pr_desc_length_chars", weight: 0.0008, antiFeature: true },
      // Codex commits typically concentrated; high distributed_changes
      // → likely Devin not Codex (anti-feature)
      { feature: "distributed_changes_score", weight: 0.40, antiFeature: true },
      { feature: "files_touched", weight: 0.05, antiFeature: true },
    ],
  },
  {
    vendor: "claude-code",
    signals: [
      { feature: "conditional_density", weight: 2.72 },
      { feature: "if_count", weight: 0.05 },
      // Claude rarely produces huge PR descriptions / many bullets
      { feature: "bullet_point_count", weight: 0.10, antiFeature: true },
      { feature: "hyperlink_count", weight: 0.10, antiFeature: true },
      // Claude doesn't usually split commits multi-line for "code-only" changes
      { feature: "multiline_commit_ratio", weight: 0.50, antiFeature: true },
    ],
  },
  {
    vendor: "copilot",
    signals: [
      { feature: "pr_desc_length_chars", weight: 0.00384 },     // 38.4% / 100 chars
      { feature: "change_concentration", weight: 0.249 },
      // Copilot tends to drop terse commits + few bullets
      { feature: "bullet_point_count", weight: 0.05, antiFeature: true },
      { feature: "hyperlink_count", weight: 0.10, antiFeature: true },
    ],
  },
  {
    vendor: "cursor",
    signals: [
      { feature: "bullet_point_count", weight: 0.172 },
      { feature: "hyperlink_count", weight: 0.128 },
      { feature: "heading_count", weight: 0.08 },
      // Cursor produces short PR descriptions relative to Copilot
      { feature: "pr_desc_length_chars", weight: 0.0006, antiFeature: true },
    ],
  },
  {
    vendor: "devin",
    signals: [
      { feature: "distributed_changes_score", weight: 1.20 },  // Devin's strongest signal
      { feature: "files_touched", weight: 0.20 },
      { feature: "multiline_commit_ratio", weight: 0.30 },
      { feature: "mean_commit_lines", weight: 0.08 },
      // Devin doesn't have Cursor-style bullets/links
      { feature: "bullet_point_count", weight: 0.10, antiFeature: true },
      { feature: "hyperlink_count", weight: 0.10, antiFeature: true },
    ],
  },
  // v2.56.0 — xAI Grok signature (Switzerland-of-AI move).
  // Derived from public Grok Code Fast / Grok Heavy patterns:
  //   - HIGHEST conditional density (branch-heavy "first-principles" code)
  //   - ULTRA-terse commit subjects ("dispatch 0" not "classify: branching helper 0")
  //   - High semicolon density (compressed expression style)
  //   - High paren density (functional composition)
  //   - Low bullet/hyperlink count (no marketing prose)
  // Discriminator vs Claude: Grok's conditional_density weight > Claude's
  // (3.5 vs 2.72) PLUS terseness bonus via max_commit_chars anti-feature
  // (penalises Claude's longer commit subjects).
  {
    vendor: "grok" as VendorId,
    signals: [
      // POSITIVES — what UNIQUELY identifies Grok output:
      //   • dense conditional dispatch
      //   • compact code with long single lines (Grok-3 style)
      //   • parenthesis-heavy (functional composition)
      //   • avoidance of switch statements (uses if-chains)
      { feature: "conditional_density", weight: 2.20 },
      { feature: "mean_line_length", weight: 0.05 },            // 38+ chars → +1.9 typical
      { feature: "paren_density", weight: 0.30 },               // 3.2 → +0.96
      { feature: "if_count", weight: 0.06 },
      // ANTI-features — penalise non-Grok shapes
      { feature: "max_commit_chars", weight: 0.12, antiFeature: true },  // Claude's verbose subjects
      { feature: "switch_count", weight: 0.20, antiFeature: true },      // Claude uses switch; Grok doesn't
      { feature: "pr_desc_length_chars", weight: 0.0015, antiFeature: true },
      { feature: "bullet_point_count", weight: 0.20, antiFeature: true },
      { feature: "hyperlink_count", weight: 0.20, antiFeature: true },
      { feature: "multiline_commit_ratio", weight: 0.50, antiFeature: true },
      { feature: "distributed_changes_score", weight: 0.60, antiFeature: true },
    ],
  },
];

/**
 * Score a fingerprint against each vendor's signature.
 * Score = Σ (weight × feature) for positive signals
 *       − Σ (weight × feature) for anti-features
 * Negative scores clamped to 0.
 */
function scoreFingerprint(fp: Fingerprint): Record<VendorId, number> {
  const scores: Partial<Record<VendorId, number>> = {};
  for (const sig of SIGNATURES) {
    let s = 0;
    for (const w of sig.signals) {
      const v = fp[w.feature] ?? 0;
      if (w.antiFeature) s -= w.weight * v;
      else s += w.weight * v;
    }
    scores[sig.vendor] = Math.max(0, s);
  }
  return scores as Record<VendorId, number>;
}

export function classifyAgent(fp: Fingerprint): AgentVerdict {
  const scores = scoreFingerprint(fp);
  let topVendor: VendorId = "unknown";
  let topScore = 0;
  let sum = 0;
  for (const [v, s] of Object.entries(scores)) {
    sum += s;
    if (s > topScore) { topScore = s; topVendor = v as VendorId; }
  }
  if (topScore === 0) {
    return { topVendor: "unknown", confidence: 0, scores, reasoning: "no signal above zero" };
  }
  const confidence = sum === 0 ? 0 : topScore / sum;
  const driving = SIGNATURES.find((s) => s.vendor === topVendor)?.signals.filter((w) => !w.antiFeature).slice(0, 3)
    .map((w) => `${String(w.feature)}=${(fp[w.feature] ?? 0).toFixed(3)}`).join(", ") ?? "";
  return {
    topVendor,
    confidence,
    scores,
    reasoning: `${topVendor} (score ${topScore.toFixed(3)}, conf ${confidence.toFixed(2)}) — driving features: ${driving}`,
  };
}

export { SIGNATURES };
