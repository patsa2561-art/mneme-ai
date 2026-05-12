/**
 * v1.69.0 -- HYPERSCAN H4: NUCLEUS DUST HTC.
 *
 * Wild idea: HTC's coverage is 0% on fresh repos because the user
 * must manually run `htc-build populate Layer 1`. We make it automatic.
 *
 * "Nucleus dust" -- every observable artifact gets compressed into a
 * tiny HTC molecule on the fly, NO manual step. The DUST accumulates
 * silently as Mneme runs.
 *
 *   - Every commit subject -> Layer 1 abstract (heuristic, no LLM)
 *   - Every file's top docstring -> Layer 1 abstract for the file
 *   - Auto-cluster by token-similarity into Layer 2
 *   - Concatenate Layer 2 into Layer 3 (memoir) on demand
 *
 * Layer 1 abstracts are HEURISTIC (no LLM call) -- "feat(area): summary"
 * commits already carry their condensation. For prose commits we
 * truncate to 30 tokens. This is a "free path" alternative to the
 * LLM-driven layer.
 *
 * Coverage tracking: total abstracts / (total commits + total source
 * files). Targets >= 80% on any healthy repo.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const DUST_DIR = ".mneme/hyperscan/htc-dust";
const ABSTRACTS_FILE = ".mneme/hyperscan/htc-dust/abstracts.jsonl";
const CLUSTERS_FILE = ".mneme/hyperscan/htc-dust/clusters.json";
const COVERAGE_FILE = ".mneme/hyperscan/htc-dust/coverage.json";

export interface DustAbstract {
  /** Stable id: hash of source. */
  id: string;
  /** What got compressed: commit hash, file path, etc. */
  source: { kind: "commit" | "file-docstring"; ref: string };
  /** The abstract text (<=30 tokens). */
  abstract: string;
  /** Estimated token count. */
  tokenCount: number;
  /** ISO ts. */
  generatedAt: string;
}

export interface DustCluster {
  clusterId: string;
  /** Topic label inferred from member abstracts. */
  label: string;
  /** Members. */
  memberIds: string[];
  /** Token count of the cluster summary. */
  tokenCount: number;
}

export interface CoverageStats {
  totalCommits: number;
  totalFiles: number;
  abstractsGenerated: number;
  coveragePct: number;
  updatedAt: string;
}

function ensureDir(repoRoot: string): void {
  const d = join(repoRoot, DUST_DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function estTokenCount(s: string): number {
  return Math.max(1, Math.round(s.split(/\s+/).length * 1.3));
}

/** Heuristic Layer-1 abstract for a commit subject. */
function abstractCommit(subject: string, body: string): string {
  // Conventional commit lines are already abstract-shaped.
  if (/^[a-z]+(\([\w-]+\))?:/.test(subject)) {
    return subject.split("\n")[0]!.slice(0, 140);
  }
  // Otherwise: take first sentence of subject + first line of body.
  const firstSent = subject.split(/(?<=[.!?])\s+/)[0]!;
  if (body) {
    const firstBodyLine = body.split("\n").find((l) => l.trim().length > 0) ?? "";
    return `${firstSent} (${firstBodyLine.slice(0, 80)})`.slice(0, 140);
  }
  return firstSent.slice(0, 140);
}

/** Heuristic Layer-1 abstract for a source-file docstring. */
function abstractDocstring(path: string, doc: string): string {
  const fname = path.split(/[\\/]/).pop()!;
  // Take the first non-empty meaningful line.
  const firstLine = doc.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("*") && !/^v\d/.test(l)) ?? doc.slice(0, 80);
  return `${fname}: ${firstLine.slice(0, 100)}`.slice(0, 140);
}

function walkSourceFiles(repoRoot: string, max = 500): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".mneme", "coverage"]);
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
          try { out.push({ path: p, content: readFileSync(p, "utf8") }); } catch { /* */ }
        }
      } catch { /* */ }
    }
  };
  walk(repoRoot);
  return out;
}

function readCommits(repoRoot: string, max = 500): Array<{ hash: string; subject: string; body: string }> {
  try {
    const r = execSync(`git -C "${repoRoot}" log --max-count=${max} --pretty=format:%H%x09%s%x09%b%n---COMMIT---`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
    return r.split(/\n---COMMIT---\n/).map((row) => {
      const [hash, subject, ...rest] = row.split("\t");
      if (!hash || !subject) return null;
      return { hash, subject, body: rest.join("\t") };
    }).filter((x): x is { hash: string; subject: string; body: string } => x !== null);
  } catch { return []; }
}

/** Idempotent: generates abstracts for everything not yet covered. */
export function generateDust(repoRoot: string, opts?: { maxCommits?: number; maxFiles?: number }): { added: number; abstracts: DustAbstract[] } {
  ensureDir(repoRoot);
  const existing = readAbstracts(repoRoot);
  const existingIds = new Set(existing.map((a) => a.id));
  const newAbstracts: DustAbstract[] = [];
  const ts = new Date().toISOString();

  for (const c of readCommits(repoRoot, opts?.maxCommits ?? 500)) {
    const id = createHash("sha256").update(`commit|${c.hash}`).digest("hex").slice(0, 16);
    if (existingIds.has(id)) continue;
    const abs = abstractCommit(c.subject, c.body);
    newAbstracts.push({
      id,
      source: { kind: "commit", ref: c.hash },
      abstract: abs,
      tokenCount: estTokenCount(abs),
      generatedAt: ts,
    });
  }
  for (const f of walkSourceFiles(repoRoot, opts?.maxFiles ?? 500)) {
    const m = f.content.match(/^\s*\/\*\*([\s\S]*?)\*\//);
    if (!m) continue;
    const id = createHash("sha256").update(`file|${f.path}`).digest("hex").slice(0, 16);
    if (existingIds.has(id)) continue;
    const abs = abstractDocstring(f.path, m[1]!);
    newAbstracts.push({
      id,
      source: { kind: "file-docstring", ref: f.path.replace(repoRoot, "").replace(/^[/\\]/, "") },
      abstract: abs,
      tokenCount: estTokenCount(abs),
      generatedAt: ts,
    });
  }
  if (newAbstracts.length > 0) {
    const fs = require("node:fs") as typeof import("node:fs");
    fs.appendFileSync(join(repoRoot, ABSTRACTS_FILE), newAbstracts.map((a) => JSON.stringify(a)).join("\n") + "\n", "utf8");
  }
  return { added: newAbstracts.length, abstracts: newAbstracts };
}

export function readAbstracts(repoRoot: string): DustAbstract[] {
  const p = join(repoRoot, ABSTRACTS_FILE);
  if (!existsSync(p)) return [];
  const out: DustAbstract[] = [];
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as DustAbstract); } catch { /* */ }
    }
  } catch { /* */ }
  return out;
}

/** Compute coverage = abstracts / (commits + source files). */
export function computeCoverage(repoRoot: string): CoverageStats {
  const commits = readCommits(repoRoot);
  const files = walkSourceFiles(repoRoot);
  const abstracts = readAbstracts(repoRoot);
  const totalCommits = commits.length;
  const totalFiles = files.filter((f) => /\/\*\*/.test(f.content.slice(0, 200))).length;
  const denominator = Math.max(1, totalCommits + totalFiles);
  const coveragePct = (abstracts.length / denominator) * 100;
  const stats: CoverageStats = {
    totalCommits,
    totalFiles,
    abstractsGenerated: abstracts.length,
    coveragePct,
    updatedAt: new Date().toISOString(),
  };
  try {
    ensureDir(repoRoot);
    writeFileSync(join(repoRoot, COVERAGE_FILE), JSON.stringify(stats, null, 2) + "\n", "utf8");
  } catch { /* */ }
  return stats;
}

/** Auto-cluster abstracts by token overlap. Lightweight; no LLM. */
export function clusterDust(repoRoot: string, opts?: { jaccardThreshold?: number; maxClusters?: number }): DustCluster[] {
  const threshold = opts?.jaccardThreshold ?? 0.3;
  const maxClusters = opts?.maxClusters ?? 50;
  const abstracts = readAbstracts(repoRoot);
  const remaining = new Set(abstracts.map((a) => a.id));
  const idToTokens = new Map<string, Set<string>>();
  for (const a of abstracts) {
    idToTokens.set(a.id, new Set((a.abstract.toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? []).filter((t) => t.length >= 4)));
  }
  const clusters: DustCluster[] = [];
  for (const seed of abstracts) {
    if (!remaining.has(seed.id) || clusters.length >= maxClusters) continue;
    const seedTokens = idToTokens.get(seed.id)!;
    const members = [seed.id];
    remaining.delete(seed.id);
    for (const other of abstracts) {
      if (!remaining.has(other.id)) continue;
      const otherTokens = idToTokens.get(other.id)!;
      const inter = [...seedTokens].filter((t) => otherTokens.has(t)).length;
      const union = seedTokens.size + otherTokens.size - inter;
      const jac = union === 0 ? 0 : inter / union;
      if (jac >= threshold) {
        members.push(other.id);
        remaining.delete(other.id);
      }
    }
    // Cluster label: most-frequent meaningful token across members.
    const tokenFreq = new Map<string, number>();
    for (const id of members) {
      for (const t of idToTokens.get(id) ?? []) tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
    }
    const label = [...tokenFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "general";
    clusters.push({
      clusterId: `cluster-${clusters.length}`,
      label,
      memberIds: members,
      tokenCount: members.length * 5,
    });
  }
  try {
    ensureDir(repoRoot);
    writeFileSync(join(repoRoot, CLUSTERS_FILE), JSON.stringify(clusters, null, 2) + "\n", "utf8");
  } catch { /* */ }
  return clusters;
}
