/**
 * Build a knowledge graph from `git log` output. No new deps -- pure
 * git CLI + JS. Caps at last N commits (default 1000) so even huge
 * repos finish in seconds.
 */

import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import type { KnowledgeGraph, KnowledgeGraphEdge, KnowledgeGraphNode } from "./types.js";

export interface BuildOptions {
  /** Max commits to walk. Default 1000. */
  maxCommits?: number;
  /** Cap on file ID list per commit (skip giant merge commits). Default 50. */
  maxFilesPerCommit?: number;
}

export function buildKnowledgeGraph(repoRoot: string, opts: BuildOptions = {}): KnowledgeGraph {
  const maxCommits = opts.maxCommits ?? 1000;
  const maxFilesPerCommit = opts.maxFilesPerCommit ?? 50;

  // Pull commits + files via git log --name-only.
  const r = spawnSync("git",
    ["log", `-${maxCommits}`, "--name-only", "--pretty=format:__C__%H%n%aN%n%s"],
    { cwd: repoRoot, encoding: "utf8", timeout: 30000, maxBuffer: 100 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    return { nodes: [], edges: [], builtAt: new Date().toISOString(), source: "git-log-failed" };
  }
  const lines = (r.stdout ?? "").split("\n");

  const commits: Array<{ sha: string; author: string; subject: string; files: string[] }> = [];
  let cur: typeof commits[number] | null = null;
  let stage = 0; // 0=expect __C__sha, 1=expect author, 2=expect subject, 3=files

  for (const line of lines) {
    if (line.startsWith("__C__")) {
      if (cur) commits.push(cur);
      cur = { sha: line.slice(5), author: "", subject: "", files: [] };
      stage = 1;
    } else if (cur && stage === 1) {
      cur.author = line.trim();
      stage = 2;
    } else if (cur && stage === 2) {
      cur.subject = line.trim();
      stage = 3;
    } else if (cur && stage === 3) {
      const t = line.trim();
      if (t && cur.files.length < maxFilesPerCommit) cur.files.push(t);
    }
  }
  if (cur) commits.push(cur);

  // Build nodes + edges.
  const nodeMap = new Map<string, KnowledgeGraphNode>();
  const edges: KnowledgeGraphEdge[] = [];
  function addNode(id: string, kind: KnowledgeGraphNode["kind"], label: string): void {
    if (!nodeMap.has(id)) nodeMap.set(id, { id, kind, label });
  }

  // Co-edit and co-author counters.
  const coEditCount = new Map<string, number>();   // "fileA|fileB" -> count
  const coAuthorCount = new Map<string, number>(); // "authorA|authorB" -> count
  const fileAuthors = new Map<string, Set<string>>(); // file -> authors

  for (const c of commits) {
    const cId = `commit:${c.sha.slice(0, 12)}`;
    addNode(cId, "commit", c.sha.slice(0, 7));
    if (c.author) {
      const aId = `author:${c.author.toLowerCase()}`;
      addNode(aId, "author", c.author);
      edges.push({ from: aId, to: cId, kind: "authored", weight: 1 });
    }
    for (const f of c.files) {
      const fId = `file:${f}`;
      addNode(fId, "file", basename(f));
      edges.push({ from: cId, to: fId, kind: "touched", weight: 1 });
      // accumulate fileAuthors
      let set = fileAuthors.get(fId);
      if (!set) { set = new Set(); fileAuthors.set(fId, set); }
      if (c.author) set.add(`author:${c.author.toLowerCase()}`);
    }
    // co-edits within this commit
    const fIds = c.files.map((f) => `file:${f}`);
    for (let i = 0; i < fIds.length; i++) {
      for (let j = i + 1; j < fIds.length; j++) {
        const key = fIds[i]! < fIds[j]! ? `${fIds[i]}|${fIds[j]}` : `${fIds[j]}|${fIds[i]}`;
        coEditCount.set(key, (coEditCount.get(key) ?? 0) + 1);
      }
    }
  }

  // Emit co-edit edges (only when count >= 2 to avoid noise).
  for (const [key, n] of coEditCount) {
    if (n < 2) continue;
    const [a, b] = key.split("|");
    if (a && b) edges.push({ from: a, to: b, kind: "co-edits", weight: Math.log(n + 1) });
  }

  // Compute co-author from fileAuthors (authors share file => co-author edge).
  for (const authors of fileAuthors.values()) {
    const arr = Array.from(authors);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = arr[i]! < arr[j]! ? `${arr[i]}|${arr[j]}` : `${arr[j]}|${arr[i]}`;
        coAuthorCount.set(key, (coAuthorCount.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, n] of coAuthorCount) {
    if (n < 2) continue;
    const [a, b] = key.split("|");
    if (a && b) edges.push({ from: a, to: b, kind: "co-author", weight: Math.log(n + 1) });
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
    builtAt: new Date().toISOString(),
    source: `git-log -${maxCommits}`,
  };
}
