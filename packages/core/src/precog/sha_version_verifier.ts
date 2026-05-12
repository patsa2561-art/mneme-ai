/**
 * v1.70.0 -- PRECOG P2: SHA / VERSION / EMAIL VERIFIER.
 *
 * Common AI fabrications:
 *   - "in commit abc1234" (commit doesn't exist)
 *   - "we shipped v9.99.0 last quarter" (no such tag)
 *   - "Alice <alice@example.com> wrote this" (no such git author)
 *
 * Each fact verifier shells out to git/CHANGELOG/git-log respectively:
 *   - SHA  -> git rev-list / git cat-file -e
 *   - Version -> git tags + CHANGELOG.md
 *   - Email -> distinct authors from git log --format=%ae
 *
 * Pure read; no side effects.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const SHA_RE = /\b([0-9a-f]{7,40})\b/gi;
const VERSION_RE = /\bv?(\d+\.\d+\.\d+(?:-[\w.-]+)?)\b/g;
const EMAIL_RE = /\b([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)\b/g;

export interface FactRef {
  kind: "sha" | "version" | "email";
  value: string;
  offset: number;
}

export interface FactSuspect {
  ref: FactRef;
  reason: string;
  confidence: number;
}

export interface FactReport {
  refs: FactRef[];
  confirmed: FactRef[];
  suspects: FactSuspect[];
  headline: string;
}

function gitCheckSha(repoRoot: string, sha: string): boolean {
  try {
    execSync(`git -C "${repoRoot}" cat-file -e ${sha}`, { stdio: "ignore", timeout: 2000 });
    return true;
  } catch { return false; }
}

function gitListTags(repoRoot: string): Set<string> {
  try {
    const r = execSync(`git -C "${repoRoot}" tag --list`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 });
    return new Set(r.split("\n").map((t) => t.trim()).filter(Boolean));
  } catch { return new Set(); }
}

function gitListAuthorEmails(repoRoot: string): Set<string> {
  try {
    const r = execSync(`git -C "${repoRoot}" log --format=%ae --max-count=2000`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 });
    const out = new Set<string>();
    for (const line of r.split("\n")) {
      const v = line.trim().toLowerCase();
      if (v) out.add(v);
    }
    return out;
  } catch { return new Set(); }
}

function changelogVersions(repoRoot: string): Set<string> {
  const p = join(repoRoot, "CHANGELOG.md");
  if (!existsSync(p)) return new Set();
  const out = new Set<string>();
  try {
    const content = readFileSync(p, "utf8");
    // Match `## [1.2.3]` / `# v1.2.3` lines.
    for (const m of content.matchAll(/^\s*#+\s*\[?v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)\]?/gm)) {
      out.add(m[1]!);
    }
  } catch { /* */ }
  return out;
}

export function extractFactRefs(text: string): FactRef[] {
  const out: FactRef[] = [];
  const seen = new Set<string>();
  const push = (ref: FactRef) => {
    const key = `${ref.kind}|${ref.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };
  for (const m of text.matchAll(SHA_RE)) {
    const v = m[1]!;
    if (v.length < 7) continue;
    if (!/[a-f]/.test(v)) continue; // pure-digit -> probably a number, not SHA
    push({ kind: "sha", value: v.toLowerCase(), offset: m.index ?? 0 });
  }
  for (const m of text.matchAll(VERSION_RE)) {
    // Use the FULL match (incl. optional "v") as the surface so hedging
    // spans correctly; the verifier strips "v" for lookup.
    push({ kind: "version", value: m[0], offset: m.index ?? 0 });
  }
  for (const m of text.matchAll(EMAIL_RE)) {
    push({ kind: "email", value: m[0].toLowerCase(), offset: m.index ?? 0 });
  }
  return out;
}

export function verifyFacts(repoRoot: string, text: string): FactReport {
  const refs = extractFactRefs(text);
  const tags = gitListTags(repoRoot);
  const changelog = changelogVersions(repoRoot);
  const authors = gitListAuthorEmails(repoRoot);
  const confirmed: FactRef[] = [];
  const suspects: FactSuspect[] = [];
  for (const ref of refs) {
    if (ref.kind === "sha") {
      if (gitCheckSha(repoRoot, ref.value)) confirmed.push(ref);
      else suspects.push({ ref, reason: `SHA ${ref.value} not found in git object database.`, confidence: 0.95 });
    } else if (ref.kind === "version") {
      const numeric = ref.value.replace(/^v/i, "");
      const inTags = tags.has(numeric) || tags.has(`v${numeric}`);
      const inChangelog = changelog.has(numeric);
      if (inTags || inChangelog) confirmed.push(ref);
      else suspects.push({ ref, reason: `Version ${ref.value} not in git tags or CHANGELOG.md.`, confidence: 0.85 });
    } else {
      if (authors.has(ref.value)) confirmed.push(ref);
      else suspects.push({ ref, reason: `Author email ${ref.value} not in git log authors.`, confidence: 0.8 });
    }
  }
  const headline = `${refs.length} fact ref(s); ${confirmed.length} confirmed, ${suspects.length} suspect.`;
  return { refs, confirmed, suspects, headline };
}
