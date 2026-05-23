/**
 * v2.31.0 — REWIND intent-class fingerprint.
 *
 * The wild fusion idea: cluster past commits by (category × surface ×
 * sizeBucket × topic-simhash). Vendor regression isn't binary "got
 * worse overall" — it's per-intent-class. A new vendor release may
 * crush feat-on-core-Medium tasks while regressing on fix-on-tests-
 * Large. The card surfaces both per-class so the user gets actionable
 * forensics, not just a single dropped number.
 *
 * Intent class is deterministic — same commits → same class. That's
 * the "time-capsule" property: pin once, fire at every vendor release,
 * compare apples-to-apples.
 */

import { createHash } from "node:crypto";
import type { IntentFingerprint } from "./types.js";
import { simhash64 } from "../squadron/acgv_vaccine.js";

const CATEGORY_RX = /^(feat|fix|docs|refactor|chore|test|build|perf|style|ci|revert|merge)\b/i;

const SURFACE_RULES: Array<{ surface: string; rx: RegExp }> = [
  { surface: "tests", rx: /(^|\/)tests?\// },
  { surface: "docs", rx: /(^|\/)(docs?|README|CHANGELOG)/i },
  { surface: "core", rx: /(^|\/)packages\/core\// },
  { surface: "mcp", rx: /(^|\/)packages\/mcp\// },
  { surface: "embeddings", rx: /(^|\/)packages\/embeddings\// },
  { surface: "cli", rx: /(^|\/)packages\/cli\// },
  { surface: "correlator", rx: /(^|\/)packages\/correlator\// },
  { surface: "scripts", rx: /(^|\/)scripts?\// },
  { surface: "ci", rx: /\.github\// },
];

export function classifyCategory(subject: string): string {
  const m = subject.match(CATEGORY_RX);
  return (m?.[1] ?? "other").toLowerCase();
}

export function classifySurface(files: string[]): string {
  if (files.length === 0) return "other";
  const counts: Record<string, number> = {};
  for (const f of files) {
    let matched = "other";
    for (const r of SURFACE_RULES) {
      if (r.rx.test(f)) { matched = r.surface; break; }
    }
    counts[matched] = (counts[matched] ?? 0) + 1;
  }
  let best = "other"; let bestCount = -1;
  for (const [k, v] of Object.entries(counts)) {
    if (v > bestCount) { best = k; bestCount = v; }
  }
  return best;
}

export function classifySize(diffLines: number): "S" | "M" | "L" | "XL" {
  if (diffLines < 20) return "S";
  if (diffLines < 200) return "M";
  if (diffLines < 2000) return "L";
  return "XL";
}

/**
 * Build an intent fingerprint. Same (category, surface, sizeBucket,
 * topic-simhash) → same intentClass key.
 *
 * topic-simhash uses subject + top file path (lower-cased) so commits
 * that touch the SAME area for the SAME reason cluster together even
 * if the message wording varies.
 */
export function buildFingerprint(subject: string, files: string[], diffLines: number): IntentFingerprint {
  const category = classifyCategory(subject);
  const surface = classifySurface(files);
  const sizeBucket = classifySize(diffLines);
  const topFile = files[0] ?? "";
  const topic = simhash64(`${subject.toLowerCase()} ${topFile.toLowerCase()}`);
  // Intent class key = HMAC-stable hash of the 4 components.
  const intentClass = createHash("sha256")
    .update(`${category}|${surface}|${sizeBucket}|${topic}`)
    .digest("hex")
    .slice(0, 12);
  return { category, surface, sizeBucket, intentClass };
}

/**
 * Score a vendor reply against an accepted diff using a deterministic
 * token-Jaccard fallback (3-char tokens) — same scoring as HONEST
 * MIRROR for cross-primitive consistency. The caller may supply an
 * embedder for higher-fidelity cosine similarity; absence is fine.
 */
export function correctnessScore(
  reply: string,
  acceptedDiff: string,
  embed?: (texts: string[]) => Promise<Float32Array[]>,
): Promise<number> {
  return scoreWithEmbed(reply, acceptedDiff, embed);
}

async function scoreWithEmbed(
  reply: string,
  acceptedDiff: string,
  embed?: (texts: string[]) => Promise<Float32Array[]>,
): Promise<number> {
  if (embed) {
    try {
      const vecs = await embed([reply, acceptedDiff]);
      if (vecs.length === 2) return clamp01(cosine(vecs[0]!, vecs[1]!));
    } catch { /* fall through */ }
  }
  // Token-Jaccard fallback with 3-char min so single tokens like "x"
  // don't collapse the score; same rule as HONEST MIRROR calibration.
  const ta = tokenize(reply);
  const tb = tokenize(acceptedDiff);
  if (ta.size === 0 && tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function tokenize(t: string): Set<string> {
  const set = new Set<string>();
  for (const tok of t.toLowerCase().split(/[^a-z0-9]+/g)) {
    if (tok.length >= 3) set.add(tok);
  }
  return set;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i]!; const bv = b[i]!;
    dot += av * bv; na += av * av; nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
