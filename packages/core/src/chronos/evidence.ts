/**
 * v2.74.0 — CHRONOS evidence extraction.
 *
 * The crux of CHRONOS: when an AI changes its answer to (effectively) the
 * same question, is that change LEGITIMATE (the world changed + the AI
 * cites the new fact) or SILENT DRIFT (the AI just changed its mind with
 * nothing backing it)?
 *
 * The discriminator is EVIDENCE. A legitimate update carries a citation
 * that wasn't there before: a source URL, an X/Twitter post, a commit
 * hash, a doc reference, a fresh date/timestamp ("as of 2026-05-28").
 *
 * This module extracts evidence tokens from an answer + decides whether a
 * NEW answer carries evidence the OLD answer did not. That "new evidence"
 * boolean is what turns a verdict change from a red flag into an honest,
 * world-tracking update — exactly the Grok / xAI case (real-time X access
 * means Grok's answers SHOULD change, but only WITH a cited X post).
 *
 * Pure deterministic.
 */

export type EvidenceKind = "x_post" | "url" | "commit" | "date" | "doc" | "version" | "pr_issue";

export interface EvidenceItem {
  kind: EvidenceKind;
  /** Normalized value used for set comparison. */
  value: string;
  /** Raw matched text (for display). */
  raw: string;
}

const PATTERNS: Array<{ kind: EvidenceKind; rx: RegExp; normalize?: (m: string) => string }> = [
  // X / Twitter post — first-class evidence for Grok's real-time access.
  { kind: "x_post", rx: /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/(\d+)/gi, normalize: (m) => {
    const id = /status\/(\d+)/.exec(m)?.[1] ?? m;
    return `x:${id}`;
  } },
  // Generic URL.
  { kind: "url", rx: /https?:\/\/[^\s)\]]+/gi, normalize: (m) => m.replace(/[.,;]+$/, "").toLowerCase() },
  // Commit hash (7-40 hex).
  { kind: "commit", rx: /\b(?:commit\s+)?([a-f0-9]{7,40})\b/gi, normalize: (m) => `commit:${(/([a-f0-9]{7,40})/.exec(m)?.[1] ?? m).toLowerCase()}` },
  // ISO date / "as of <date>".
  { kind: "date", rx: /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?Z?)?\b/g, normalize: (m) => `date:${m.slice(0, 10)}` },
  // Semantic version.
  { kind: "version", rx: /\bv?\d+\.\d+\.\d+(?:-[a-z0-9.]+)?\b/gi, normalize: (m) => `ver:${m.replace(/^v/i, "")}` },
  // Doc / file reference.
  { kind: "doc", rx: /\b[A-Za-z0-9_./-]+\.(?:md|ts|js|tsx|jsx|py|rs|go|json|ya?ml|toml|pdf|txt)\b/g, normalize: (m) => `doc:${m.toLowerCase()}` },
  // PR / issue reference.
  { kind: "pr_issue", rx: /\b(?:pull\s+request|pr|issue)\s+#?(\d+)\b/gi, normalize: (m) => `pr:${/#?(\d+)/.exec(m)?.[1] ?? m}` },
];

/**
 * Extract evidence items from an answer. Order matters: x_post is checked
 * before the generic url pattern so an X post is classified as x_post (and
 * its generic-URL form is de-duplicated by value).
 */
export function extractEvidence(text: string): EvidenceItem[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  // Track which raw URL substrings were already claimed by x_post so the
  // generic url pattern doesn't double-count them.
  const claimedSpans: string[] = [];
  for (const { kind, rx, normalize } of PATTERNS) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const raw = m[0];
      if (!raw) { if (rx.lastIndex === m.index) rx.lastIndex++; continue; }
      // If a previous (higher-priority) pattern already claimed this exact
      // substring, skip (prevents x_post being re-counted as url).
      if (kind === "url" && claimedSpans.some((s) => s === raw || raw.includes(s) || s.includes(raw))) {
        if (rx.lastIndex === m.index) rx.lastIndex++;
        continue;
      }
      const value = normalize ? normalize(raw) : raw.toLowerCase();
      const dedupKey = `${kind}|${value}`;
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        out.push({ kind, value, raw });
        if (kind === "x_post") claimedSpans.push(raw);
      }
      if (rx.lastIndex === m.index) rx.lastIndex++;
    }
  }
  return out;
}

/** Set of normalized evidence values (kind-qualified). */
export function evidenceValueSet(items: EvidenceItem[]): Set<string> {
  return new Set(items.map((i) => `${i.kind}|${i.value}`));
}

export interface EvidenceDelta {
  /** Evidence present in the NEW answer but NOT in the OLD answer. */
  added: EvidenceItem[];
  /** True iff the new answer carries at least one citation the old lacked. */
  hasNewEvidence: boolean;
}

/**
 * Compute what evidence the NEW answer adds over the OLD answer. A verdict
 * change is "legitimate" iff hasNewEvidence is true.
 */
export function evidenceDelta(oldText: string, newText: string): EvidenceDelta {
  const oldItems = extractEvidence(oldText);
  const newItems = extractEvidence(newText);
  const oldSet = evidenceValueSet(oldItems);
  const added = newItems.filter((i) => !oldSet.has(`${i.kind}|${i.value}`));
  return { added, hasNewEvidence: added.length > 0 };
}
