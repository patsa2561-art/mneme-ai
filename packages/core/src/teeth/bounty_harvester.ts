/**
 * DEMON STAGE 2.1 — Autonomous Bug-Bounty Harvester (v1.44.0)
 *
 * SCOPE: scan the watched repo's `package.json` direct dependencies against
 * a local advisory cache, then draft a HackerOne / Bugcrowd-quality
 * vulnerability report in markdown. NEVER auto-submits. Always for human
 * review. The cache is seeded by the operator (e.g. the daemon syncs OSV
 * snapshots into `.mneme/advisories/<ecosystem>.jsonl`); we never embed
 * a hard-coded CVE list (would rot in days).
 *
 * SAFETY:
 *   - Read-only on disk except for the draft output dir
 *   - No network calls (the operator handles advisory ingestion separately)
 *   - Reports are .md files, never JSON-armed exploits
 *   - Severity filter: only "high" or "critical" advisories produce drafts
 *   - Caps at 50 drafts/run to prevent flood
 *
 * INNOVATIONS BEYOND SPEC:
 *   - Range-aware match using SemVer (rejects false positives from substring matches)
 *   - "Already-fixed" suppression: if the advisory's `fixed_in` ≤ user's installed
 *     version, the advisory is silently dropped (no noise)
 *   - PoC SCAFFOLD generated only when advisory carries a `repro` field, and even
 *     then it's a placeholder — never a working exploit
 *   - `submitted` ledger at `.mneme/bounty-submitted.jsonl` so re-runs don't
 *     produce duplicate drafts for the same advisory+repo
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

export type Severity = "low" | "medium" | "high" | "critical";

export interface Advisory {
  id: string;                  // e.g. "GHSA-xxx" or "CVE-yyyy-nnnn"
  ecosystem: "npm" | "pypi" | "cargo" | "maven" | "rubygems";
  package: string;
  vulnerableRange: string;     // npm-style range, e.g. "<1.2.3 || >=2.0.0 <2.1.4"
  fixedIn: string | null;      // e.g. "1.2.3", null when no fix
  severity: Severity;
  title: string;
  summary: string;
  references: string[];        // URLs (advisory pages, NVD, vendor)
  repro?: string;              // optional reproduction hint
  cwe?: string;                // e.g. "CWE-79"
}

export interface BountyDraft {
  draftId: string;             // sha256(advisoryId + package + installedVersion)
  advisoryId: string;
  package: string;
  installedVersion: string;
  fixedIn: string | null;
  severity: Severity;
  reportPath: string;          // path to the .md draft on disk
  outcome: "drafted" | "duplicate" | "below-threshold" | "already-patched" | "no-match";
}

export interface HarvestReport {
  ranAt: string;               // ISO-8601
  scanned: number;             // direct deps inspected
  drafted: BountyDraft[];      // new drafts this run
  skipped: BountyDraft[];      // duplicate / below-threshold / already-patched
  errors: { package: string; reason: string }[];
}

interface InstalledDep { name: string; version: string }

const SEVERITY_THRESHOLD: Severity[] = ["high", "critical"];
const MAX_DRAFTS_PER_RUN = 50;

function readAdvisoriesCache(repoRoot: string): Advisory[] {
  const dir = join(repoRoot, ".mneme", "advisories");
  if (!existsSync(dir)) return [];
  const out: Advisory[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    const lines = readFileSync(join(dir, f), "utf8").split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        const a = JSON.parse(line) as Advisory;
        if (typeof a.id === "string" && typeof a.package === "string") out.push(a);
      } catch { /* skip malformed line */ }
    }
  }
  return out;
}

function readDirectDeps(repoRoot: string): InstalledDep[] {
  const pkgPath = join(repoRoot, "package.json");
  if (!existsSync(pkgPath)) return [];
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return [];
  }
  const out: InstalledDep[] = [];
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
    out.push({ name, version: stripCaretTilde(range) });
  }
  for (const [name, range] of Object.entries(pkg.devDependencies ?? {})) {
    out.push({ name, version: stripCaretTilde(range) });
  }
  return out;
}

function stripCaretTilde(range: string): string {
  return range.replace(/^[\^~]/, "").trim();
}

function parseSemver(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

function cmpSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

/**
 * Minimal SemVer range matcher. Supports comma/space-separated AND clauses,
 * `||` OR clauses, and `<`, `<=`, `>`, `>=`, `=`. NOT a full npm-semver impl —
 * deliberately small. Unknown ranges return false (fail-closed: prefer missed
 * advisory over false bounty noise).
 */
export function inRange(version: string, range: string): boolean {
  const v = parseSemver(version);
  if (!v) return false;
  const orParts = range.split("||").map((s) => s.trim()).filter(Boolean);
  for (const orPart of orParts) {
    const andParts = orPart.split(/\s+/).filter(Boolean);
    let allMatch = true;
    for (const clause of andParts) {
      const m = clause.match(/^(>=|<=|>|<|=)?\s*(\d+\.\d+\.\d+)/);
      if (!m) { allMatch = false; break; }
      const op = m[1] ?? "=";
      const target = parseSemver(m[2]!)!;
      const cmp = cmpSemver(v, target);
      let ok: boolean;
      switch (op) {
        case "<": ok = cmp < 0; break;
        case "<=": ok = cmp <= 0; break;
        case ">": ok = cmp > 0; break;
        case ">=": ok = cmp >= 0; break;
        case "=": ok = cmp === 0; break;
        default: ok = false;
      }
      if (!ok) { allMatch = false; break; }
    }
    if (allMatch) return true;
  }
  return false;
}

function alreadyPatched(installed: string, fixedIn: string | null): boolean {
  if (!fixedIn) return false;
  const a = parseSemver(installed);
  const b = parseSemver(fixedIn);
  if (!a || !b) return false;
  return cmpSemver(a, b) >= 0;
}

function draftIdFor(advisoryId: string, pkg: string, installed: string): string {
  return createHash("sha256").update(`${advisoryId}|${pkg}|${installed}`).digest("hex").slice(0, 16);
}

function readSubmittedLedger(repoRoot: string): Set<string> {
  const path = join(repoRoot, ".mneme", "bounty-submitted.jsonl");
  if (!existsSync(path)) return new Set();
  const out = new Set<string>();
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as { draftId?: string };
      if (obj.draftId) out.add(obj.draftId);
    } catch { /* skip */ }
  }
  return out;
}

function appendSubmittedLedger(repoRoot: string, draft: BountyDraft): void {
  const path = join(repoRoot, ".mneme", "bounty-submitted.jsonl");
  mkdirSync(join(repoRoot, ".mneme"), { recursive: true });
  appendFileSync(path, JSON.stringify({ draftId: draft.draftId, advisoryId: draft.advisoryId, package: draft.package, at: new Date().toISOString() }) + "\n");
}

function escMd(s: string): string {
  // minimal: collapse pipes (would break tables) + trim
  return s.replace(/\|/g, "\\|").trim();
}

function renderReport(advisory: Advisory, dep: InstalledDep, draftId: string): string {
  const lines: string[] = [];
  lines.push(`# Vulnerability Report — ${escMd(advisory.id)}`);
  lines.push("");
  lines.push(`**Draft ID:** \`${draftId}\``);
  lines.push(`**Generated by:** Mneme bug-bounty harvester (v1.44.0)`);
  lines.push(`**Status:** DRAFT — human review required before submission`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(escMd(advisory.summary));
  lines.push("");
  lines.push("## Affected");
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Package | \`${escMd(advisory.package)}\` (${advisory.ecosystem}) |`);
  lines.push(`| Installed version | \`${escMd(dep.version)}\` |`);
  lines.push(`| Vulnerable range | \`${escMd(advisory.vulnerableRange)}\` |`);
  lines.push(`| Fixed in | ${advisory.fixedIn ? `\`${escMd(advisory.fixedIn)}\`` : "_no fix yet_"} |`);
  lines.push(`| Severity | **${advisory.severity.toUpperCase()}** |`);
  if (advisory.cwe) lines.push(`| CWE | ${escMd(advisory.cwe)} |`);
  lines.push("");
  lines.push("## Reproduction");
  lines.push("");
  if (advisory.repro) {
    lines.push("```");
    lines.push(advisory.repro);
    lines.push("```");
    lines.push("");
    lines.push("> ⚠️  This is a SCAFFOLD only. Confirm reproducibility in a sandbox before reporting.");
  } else {
    lines.push("_No reproduction hint in advisory cache. Investigate manually before submitting._");
  }
  lines.push("");
  lines.push("## Recommended fix");
  lines.push("");
  if (advisory.fixedIn) {
    lines.push(`Upgrade \`${escMd(advisory.package)}\` to \`>=${escMd(advisory.fixedIn)}\`.`);
  } else {
    lines.push(`No upstream fix is published. Consider pinning to a known-good version, applying a patch fork, or removing the dependency.`);
  }
  lines.push("");
  lines.push("## References");
  lines.push("");
  for (const url of advisory.references) lines.push(`- ${escMd(url)}`);
  lines.push("");
  lines.push("---");
  lines.push("> Drafted by Mneme. The harvester never submits reports automatically. Review every claim before forwarding to a bounty platform or vendor.");
  return lines.join("\n");
}

export function harvestBounties(repoRoot: string): HarvestReport {
  const root = resolve(repoRoot);
  const advisories = readAdvisoriesCache(root);
  const deps = readDirectDeps(root);
  const submitted = readSubmittedLedger(root);
  const draftDir = join(root, ".mneme", "bounty-drafts");

  const drafted: BountyDraft[] = [];
  const skipped: BountyDraft[] = [];
  const errors: { package: string; reason: string }[] = [];

  outer: for (const dep of deps) {
    for (const adv of advisories) {
      if (drafted.length >= MAX_DRAFTS_PER_RUN) break outer;
      if (adv.package !== dep.name) continue;

      const draftId = draftIdFor(adv.id, dep.name, dep.version);
      const base: BountyDraft = {
        draftId,
        advisoryId: adv.id,
        package: dep.name,
        installedVersion: dep.version,
        fixedIn: adv.fixedIn,
        severity: adv.severity,
        reportPath: "",
        outcome: "no-match",
      };

      // Filter range FIRST — if not vulnerable, advisory is irrelevant (silent)
      if (!inRange(dep.version, adv.vulnerableRange)) continue;
      if (!SEVERITY_THRESHOLD.includes(adv.severity)) {
        skipped.push({ ...base, outcome: "below-threshold" });
        continue;
      }
      if (alreadyPatched(dep.version, adv.fixedIn)) {
        skipped.push({ ...base, outcome: "already-patched" });
        continue;
      }
      if (submitted.has(draftId)) {
        skipped.push({ ...base, outcome: "duplicate" });
        continue;
      }

      try {
        mkdirSync(draftDir, { recursive: true });
        const reportPath = join(draftDir, `${draftId}_${adv.id.replace(/[^A-Za-z0-9_.-]/g, "_")}.md`);
        writeFileSync(reportPath, renderReport(adv, dep, draftId));
        const draft: BountyDraft = { ...base, reportPath, outcome: "drafted" };
        drafted.push(draft);
        appendSubmittedLedger(root, draft);
      } catch (e) {
        errors.push({ package: dep.name, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return {
    ranAt: new Date().toISOString(),
    scanned: deps.length,
    drafted,
    skipped,
    errors,
  };
}

export function listSubmittedDrafts(repoRoot: string): { draftId: string; advisoryId: string; package: string; at: string }[] {
  const path = join(repoRoot, ".mneme", "bounty-submitted.jsonl");
  if (!existsSync(path)) return [];
  const out: { draftId: string; advisoryId: string; package: string; at: string }[] = [];
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}
