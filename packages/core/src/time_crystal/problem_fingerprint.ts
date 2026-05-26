/**
 * v2.63.0 — TIME-CRYSTAL problem fingerprinting.
 *
 * Two agents hitting the same problem will type it slightly differently:
 *   "Cannot find module '@types/node'"
 *   "TypeScript Error TS2307: Cannot find module @types/node"
 *   "error: cannot find module @types/node when building"
 *
 * All three should cluster to ONE wisdom bucket. The fingerprint is a
 * canonical hash of the SHAPE of the problem after normalization.
 *
 * Pipeline:
 *  1. Lowercase
 *  2. Strip stack-trace prefixes (file:line:col, "at Function.foo (path)")
 *  3. Normalize entities to slot tokens:
 *      "@types/node"     → "<PKG>"
 *      "5.6.3"           → "<VER>"
 *      "src/file.ts"     → "<PATH>"
 *      "2026-05-26"      → "<DATE>"
 *      "abc1234"         → "<HASH>"
 *      numbers 3+ digits → "<N>"
 *  4. Strip filler / TypeScript error codes (TS2307 etc.)
 *  5. Tokenize, remove common stop-words, sort, join
 *  6. SHA-256 → 16 hex char fingerprint
 *
 * The slot tokens are KEPT in the fingerprint (just normalized) so
 * "Cannot find module @types/node" and "Cannot find module foo" share
 * structure but NOT specifically — they collapse to the same shape.
 *
 * Pure deterministic.
 */

import { createHash } from "node:crypto";

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "by",
  "for", "with", "from", "is", "was", "are", "were", "be", "been", "being",
  "do", "does", "did", "doing", "have", "has", "had", "having", "will",
  "would", "should", "could", "may", "might", "must", "this", "that",
  "these", "those", "it", "its", "as", "if", "then", "than", "so", "such",
  "very", "just", "only", "also", "again", "ever", "still", "yet",
  "error", "warning", "exception", "failure", "problem", "issue",
]);

const TS_ERROR_CODE = /\bTS\d{4,5}\b/g;
const STACK_LINE = /^\s*at\s.+(\(.+\))?$/gm;
const FILE_LINE_COL = /\b[A-Za-z_][A-Za-z0-9_./\\-]*:\d+(:\d+)?\b/g;
const PKG_SCOPED = /@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*/gi;
const PKG_BARE = /\b[a-z][a-z0-9_-]*(?:-[a-z0-9_-]+){0,3}\b(?=@\d)/gi; // pkg before @version
const SEMVER = /\bv?\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.]+)?(?:\+[a-z0-9.]+)?\b/gi;
const PATH_RX = /\b[A-Za-z_][A-Za-z0-9_/\\.-]*\.(?:ts|tsx|js|jsx|cjs|mjs|py|rs|go|java|kt|swift|md|json|yaml|yml|toml|sh|sql|html|css|tex)\b/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?\b/g;
const SHA_HASH = /\b[a-f0-9]{7,40}\b/g;
const URL_RX = /https?:\/\/\S+/g;
const BIG_NUM = /\b\d{3,}(?:,\d{3})*\b/g;
const QUOTES = /[`'"]/g;

export interface NormalizationResult {
  /** Canonical text after entity slotting + stop-word removal. */
  canonical: string;
  /** Stable 16-hex fingerprint hash. */
  fingerprint: string;
  /** Slot counts (informational). */
  slots: Record<string, number>;
}

export function normalizeProblem(text: string): NormalizationResult {
  if (typeof text !== "string" || text.length === 0) {
    return { canonical: "", fingerprint: "0".repeat(16), slots: {} };
  }
  let s = text.toLowerCase();
  // Strip stack-trace + file:line:col patterns first.
  s = s.replace(STACK_LINE, " ");
  s = s.replace(URL_RX, " <URL> ");
  s = s.replace(ISO_DATE, " <DATE> ");
  // Order matters: scoped packages BEFORE bare-pkg-before-version BEFORE semver.
  s = s.replace(PKG_SCOPED, " <PKG> ");
  s = s.replace(SEMVER, " <VER> ");
  s = s.replace(PATH_RX, " <PATH> ");
  s = s.replace(SHA_HASH, " <HASH> ");
  s = s.replace(FILE_LINE_COL, " <LOC> ");
  s = s.replace(TS_ERROR_CODE, " <TSERR> ");
  s = s.replace(BIG_NUM, " <N> ");
  s = s.replace(QUOTES, " ");

  // Tokenize on non-word boundaries (but keep angle brackets for slots).
  const tokens: string[] = s.split(/[^a-z0-9_<>]+/i).map((t) => t.trim()).filter((t) => t.length > 0);
  const filtered = tokens.filter((t) => !STOP_WORDS.has(t) && t.length >= 2);
  // Sort for canonical form so order doesn't matter.
  filtered.sort();
  const canonical = filtered.join(" ");

  // Slot counts.
  const slots: Record<string, number> = {};
  for (const t of filtered) {
    if (/^<.+>$/.test(t)) slots[t] = (slots[t] ?? 0) + 1;
  }

  const fingerprint = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return { canonical, fingerprint, slots };
}

/** Jaccard similarity between two canonical-tokens sets. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const sa = new Set(a.split(/\s+/).filter(Boolean));
  const sb = new Set(b.split(/\s+/).filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersect = 0;
  for (const t of sa) if (sb.has(t)) intersect++;
  return intersect / (sa.size + sb.size - intersect);
}
