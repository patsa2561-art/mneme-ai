/**
 * v1.69.0 -- HYPERSCAN H3: CROSS-SOURCE Q&A FUSION.
 *
 * Wild idea: when commit messages don't fully describe a feature
 * (HTC was named only AFTER its first commit, so commit search for
 * "HTC compression" returns weak results), Mneme should NOT just
 * trust commit retrieval. Fuse retrieval across N orthogonal sources:
 *
 *   1. Commit subjects + bodies      (existing)
 *   2. README.md sections             (existing-ish)
 *   3. CHANGELOG.md entries           (NEW - structured release notes)
 *   4. Source-file top docstrings     (NEW - module docs)
 *   5. package.json description       (NEW - terse, but authoritative)
 *
 * Each source scored independently via TF-Jaccard. Final trust is a
 * weighted fusion. When sources align (high cross-source agreement),
 * trust is HIGH. When they diverge, trust drops but we report all
 * sources so the user can see what each says.
 *
 * The wild bit: SHAPE-SHIFTING. The "winning answer" is constructed
 * by taking the BEST sentence from EACH source and stitching them
 * into a multi-witness reply.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { safeExecTry } from "../util/safe_exec.js";

export type SourceKind = "commit" | "readme" | "changelog" | "docstring" | "package-json";

export interface SourceHit {
  source: SourceKind;
  citation: string;       // where it came from
  excerpt: string;        // text snippet
  score: number;          // 0..1
}

export interface FusedAnswer {
  question: string;
  hits: SourceHit[];
  /** Sources that contributed at least one hit. */
  sourcesPresent: SourceKind[];
  /** Fused trust 0..1. */
  trust: number;
  trustLabel: "HIGH" | "MEDIUM" | "LOW";
  /** The stitched multi-witness answer (best snippet per source). */
  fusedAnswer: string;
  /** Per-source max score (for transparency). */
  perSourceMax: Record<SourceKind, number>;
  ms: number;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "when", "then",
  "function", "const", "var", "let", "true", "false", "null", "return", "import", "export",
  "type", "interface", "class", "public", "private", "static", "async", "await",
  "what", "how", "why", "where", "which", "who", "use", "uses", "used",
]);

function tokenize(s: string): Set<string> {
  return new Set(
    (s.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function readMaybeFile(p: string): string {
  if (!existsSync(p)) return "";
  try { return readFileSync(p, "utf8"); } catch { return ""; }
}

function readCommitSubjects(repoRoot: string, max = 500): string[] {
  // v2.4: spawnSync via safeExecTry (no shell).
  const r = safeExecTry("git", ["-C", repoRoot, "log", `--max-count=${max}`, "--pretty=format:%s%n%b%n---"], { timeoutMs: 3000 });
  if (r?.status !== 0) return [];
  return r.stdout.split(/\n---\n/).map((s) => s.trim()).filter(Boolean);
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter((s) => s.length >= 10);
}

function rankSnippets(query: Set<string>, source: SourceKind, text: string, citation: string): SourceHit[] {
  const sentences = splitSentences(text);
  const hits: SourceHit[] = [];
  for (const sent of sentences) {
    const score = jaccard(query, tokenize(sent));
    if (score >= 0.1) hits.push({ source, citation, excerpt: sent.slice(0, 280), score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 3);
}

function readSourceDocstrings(repoRoot: string, max = 50): Array<{ path: string; doc: string }> {
  const out: Array<{ path: string; doc: string }> = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".mneme"]);
  const walk = (dir: string) => {
    if (out.length >= max) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (skip.has(e)) continue;
      const p = join(dir, e);
      try {
        const s = statSync(p);
        if (s.isDirectory()) walk(p);
        else if (/\.ts$/.test(e)) {
          let content = "";
          try { content = readFileSync(p, "utf8"); } catch { continue; }
          // Top-of-file docstring: `/** ... */` at the very start.
          const m = content.match(/^\s*\/\*\*([\s\S]*?)\*\//);
          if (m) out.push({ path: p, doc: m[1]!.replace(/^\s*\*/gm, "").trim() });
          if (out.length >= max) return;
        }
      } catch { /* */ }
    }
  };
  walk(repoRoot);
  return out;
}

export function crossSourceAsk(repoRoot: string, question: string, opts?: { maxCommits?: number; maxFiles?: number }): FusedAnswer {
  const t0 = Date.now();
  const query = tokenize(question);
  const hits: SourceHit[] = [];

  // 1. Commits
  for (const commit of readCommitSubjects(repoRoot, opts?.maxCommits ?? 500)) {
    const ranked = rankSnippets(query, "commit", commit, "commit");
    for (const h of ranked.slice(0, 1)) hits.push(h);
    if (hits.length >= 60) break;
  }

  // 2. README
  const readme = readMaybeFile(join(repoRoot, "README.md"));
  if (readme) hits.push(...rankSnippets(query, "readme", readme, "README.md"));

  // 3. CHANGELOG
  const changelog = readMaybeFile(join(repoRoot, "CHANGELOG.md"));
  if (changelog) hits.push(...rankSnippets(query, "changelog", changelog, "CHANGELOG.md"));

  // 4. Docstrings
  for (const { path, doc } of readSourceDocstrings(repoRoot, opts?.maxFiles ?? 50)) {
    const ranked = rankSnippets(query, "docstring", doc, path.split(/[\\/]/).slice(-2).join("/"));
    hits.push(...ranked.slice(0, 1));
  }

  // 5. package.json description
  const pkgRaw = readMaybeFile(join(repoRoot, "package.json"));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
      const desc = String(pkg["description"] ?? "");
      if (desc) hits.push(...rankSnippets(query, "package-json", desc, "package.json"));
    } catch { /* */ }
  }

  // Per-source max scores.
  const perSourceMax: Record<SourceKind, number> = { commit: 0, readme: 0, changelog: 0, docstring: 0, "package-json": 0 };
  const presentSources = new Set<SourceKind>();
  for (const h of hits) {
    if (h.score > perSourceMax[h.source]) perSourceMax[h.source] = h.score;
    presentSources.add(h.source);
  }

  // Trust fusion: weighted avg of per-source max, weighted by source authority.
  const WEIGHTS: Record<SourceKind, number> = {
    docstring: 1.2,     // module-level intent
    changelog: 1.1,     // structured release notes
    readme: 1.0,        // canonical user-facing doc
    commit: 0.8,        // many noisy entries
    "package-json": 0.6, // terse but authoritative
  };
  let weightedSum = 0, weightSum = 0;
  for (const k of Object.keys(perSourceMax) as SourceKind[]) {
    const w = WEIGHTS[k];
    weightedSum += perSourceMax[k] * w;
    weightSum += w;
  }
  const baseTrust = weightSum === 0 ? 0 : weightedSum / weightSum;
  // Cross-source agreement boost: 2+ sources with >= 0.2 -> +0.15.
  const strongSources = (Object.values(perSourceMax) as number[]).filter((v) => v >= 0.2).length;
  const agreementBoost = strongSources >= 3 ? 0.25 : strongSources >= 2 ? 0.15 : 0;
  const trust = Math.min(1, baseTrust * 2 + agreementBoost); // *2 because Jaccard is naturally low

  let trustLabel: FusedAnswer["trustLabel"];
  if (trust >= 0.7) trustLabel = "HIGH";
  else if (trust >= 0.4) trustLabel = "MEDIUM";
  else trustLabel = "LOW";

  // Build fused answer: top snippet from each source that contributed.
  const bestPerSource = new Map<SourceKind, SourceHit>();
  for (const h of hits) {
    const prev = bestPerSource.get(h.source);
    if (!prev || h.score > prev.score) bestPerSource.set(h.source, h);
  }
  const fusedLines: string[] = [];
  for (const k of ["docstring", "changelog", "readme", "commit", "package-json"] as SourceKind[]) {
    const h = bestPerSource.get(k);
    if (h && h.score >= 0.1) fusedLines.push(`[${k}@${h.citation}] ${h.excerpt}`);
  }
  const fusedAnswer = fusedLines.length === 0
    ? "(no source had sufficient overlap with the question; trust LOW)"
    : fusedLines.join("\n\n");

  hits.sort((a, b) => b.score - a.score);
  return {
    question,
    hits: hits.slice(0, 10),
    sourcesPresent: [...presentSources],
    trust,
    trustLabel,
    fusedAnswer,
    perSourceMax,
    ms: Date.now() - t0,
  };
}
