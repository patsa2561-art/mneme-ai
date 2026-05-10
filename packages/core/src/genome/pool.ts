/**
 * Genome Pool packager (v1.26.4 MVP).
 *
 * Bundles a user's chromosomes into a PII-scrubbed package suitable
 * for upload to a (future) public Mneme genome pool. The MVP intent:
 *
 *   - We do NOT upload anywhere yet. The output is a single JSON
 *     file the user reviews + (later) ships via a separate command.
 *   - PII scrubbing is conservative: emails, IPs, GitHub handles,
 *     absolute file paths all get redacted to <REDACTED>.
 *   - Each chromosome is hashed (sha256) so the public pool can
 *     dedup contributions without seeing source.
 *
 * This is the Phase 1 deliverable from the v1.27 phase plan -- enough
 * to demo the network-effect story without committing to backend
 * infrastructure yet.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

// v1.27.9 (BUG FIX): pre-fix the packager read from the non-existent
// `.mneme/lineage/chromosomes.jsonl` -- chromosomes are actually
// stored as INDIVIDUAL JSON files at
// `.mneme/lineage/chromosomes/<id>.chromosome.json`. This is why the
// genome-pool stayed empty across v1.27.5/v1.27.6/v1.27.7/v1.27.8 even
// after seed --demo planted 3 chromosomes (user reported 3 rounds).
const CHROMOSOMES_DIR = ".mneme/lineage/chromosomes";

export interface GenomePoolEntry {
  /** sha256 of the redacted chromosome JSON. Lets the pool dedup. */
  hash: string;
  /** Vendor / AI tool that produced the chromosome (claude/cursor/codex/etc). */
  vendor: string;
  /** Topic / domain (e.g. "stripe-webhook", "react-hook"). */
  topic: string;
  /** ISO timestamp of contribution (NOT original chromosome creation). */
  contributedAt: string;
  /** Redacted body. PII fields swapped for <REDACTED>. */
  body: string;
}

export interface GenomePoolPackage {
  /** Format version. */
  v: 1;
  /** ISO timestamp the package was generated. */
  generatedAt: string;
  /** sha256 of the originator's repo path (NOT the path itself). */
  repoFingerprint: string;
  /** Total chromosomes packaged. */
  count: number;
  /** Redacted entries. */
  entries: GenomePoolEntry[];
}

const PII_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  // Emails
  { re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replacement: "<EMAIL>" },
  // Absolute Windows paths
  { re: /[A-Z]:\\[^\s"'`]+/g, replacement: "<PATH>" },
  // Absolute POSIX paths under common home/tmp roots
  { re: /\/(?:home|Users|tmp|var)\/[^\s"'`]+/g, replacement: "<PATH>" },
  // GitHub handles in @form
  { re: /@[A-Za-z0-9-]{2,30}/g, replacement: "<HANDLE>" },
  // IPv4
  { re: /\b(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}\b/g, replacement: "<IP>" },
  // Bearer tokens / API keys (heuristic: 24+ char alnum strings)
  { re: /\b[A-Za-z0-9_-]{24,}\b/g, replacement: "<SECRET>" },
];

/**
 * v1.27.8 -- when a chromosome has no explicit notes field, synthesise
 * a structured paragraph from the fields that DO exist (topic, voice
 * fingerprint, molecules, atom karma, session metadata). Returns empty
 * string only when there's truly nothing meaningful to share.
 */
function synthesiseNotesFromChromosome(c: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const topic = typeof c["topic"] === "string" ? c["topic"] : "";
  const vendor = typeof c["vendor"] === "string" ? c["vendor"] : "unknown";
  const voice = c["voiceFingerprint"] as { topPhrases?: string[]; topTopics?: string[] } | undefined;
  const molecules = Array.isArray(c["molecules"]) ? c["molecules"] as Array<{ name?: string; fireCount?: number; karma?: number }> : [];
  const atomKarma = c["atomKarmaDeltas"] as Record<string, { karma?: number; invocations?: number; verified?: number }> | undefined;
  const session = c["session"] as { totalCalls?: number; endReason?: string } | undefined;

  if (topic) parts.push(`Session topic: ${topic}.`);
  if (vendor !== "unknown") parts.push(`Captured by ${vendor}.`);
  if (molecules.length > 0) {
    const top = molecules.slice(0, 3).map((m) => `${m.name ?? "?"} (fired ${m.fireCount ?? 0}x)`).join(", ");
    parts.push(`Active molecules: ${top}.`);
  }
  if (atomKarma) {
    const ranked = Object.entries(atomKarma)
      .sort((a, b) => (b[1].karma ?? 0) - (a[1].karma ?? 0))
      .slice(0, 5)
      .map(([atom, d]) => `${atom} (karma ${d.karma ?? 0}, ${d.invocations ?? 0} calls)`);
    if (ranked.length > 0) parts.push(`Top atoms by karma: ${ranked.join(", ")}.`);
  }
  if (voice?.topTopics && voice.topTopics.length > 0) {
    parts.push(`Topics surfaced: ${voice.topTopics.slice(0, 5).join(", ")}.`);
  }
  if (session) {
    parts.push(`Session ended via ${session.endReason ?? "?"} after ${session.totalCalls ?? 0} calls.`);
  }
  const synthesised = parts.join(" ").trim();
  return synthesised.length >= 60 ? synthesised : null;
}

/** Redact PII from a string. Conservative -- prefers false-positive
 *  over false-negative (some valid technical strings will be over-
 *  redacted; that's fine for a public pool). */
export function scrubPII(input: string): string {
  let out = input;
  for (const { re, replacement } of PII_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

/** Read every chromosome from the lineage store. v1.27.9: reads
 *  per-chromosome JSON files from `.mneme/lineage/chromosomes/`,
 *  not a single .jsonl file (the .jsonl path was a bug). */
function readChromosomes(repoRoot: string): Array<Record<string, unknown>> {
  const dir = join(repoRoot, CHROMOSOMES_DIR);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".chromosome.json"))
      .map((f) => {
        try { return JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, unknown>; }
        catch { return null; }
      })
      .filter((x): x is Record<string, unknown> => x !== null);
  } catch {
    return [];
  }
}

function repoFingerprintOf(repoRoot: string): string {
  return createHash("sha256").update(repoRoot).digest("hex").slice(0, 16);
}

/**
 * Build a GenomePoolPackage from the lineage store. Filters by minimum
 * chromosome quality (must have a `topic` and a `notes` body).
 *
 * Returns null if there's nothing to contribute.
 */
export function buildPackage(repoRoot: string): GenomePoolPackage | null {
  const all = readChromosomes(repoRoot);
  if (all.length === 0) return null;
  const entries: GenomePoolEntry[] = [];
  for (const c of all) {
    const vendor = typeof c["vendor"] === "string" ? c["vendor"] : "unknown";
    const topic = typeof c["topic"] === "string" ? c["topic"] : null;
    // v1.27.8: prefer explicit notes, then body, then synthesise from
    // existing chromosome fields. Lets ANY chromosome (including pre-
    // v1.27.8 ones without an explicit notes field) ship to the pool
    // with at least a structured summary.
    let notes: string | null =
      typeof c["notes"] === "string" ? c["notes"]
      : typeof c["body"] === "string" ? c["body"]
      : null;
    if (!notes) {
      notes = synthesiseNotesFromChromosome(c);
    }
    if (!topic || !notes) continue;
    const redactedBody = scrubPII(notes);
    const hash = createHash("sha256")
      .update(vendor).update(topic).update(redactedBody)
      .digest("hex").slice(0, 16);
    entries.push({
      hash,
      vendor: scrubPII(vendor),
      topic: scrubPII(topic),
      contributedAt: new Date().toISOString(),
      body: redactedBody,
    });
  }
  if (entries.length === 0) return null;
  return {
    v: 1,
    generatedAt: new Date().toISOString(),
    repoFingerprint: repoFingerprintOf(repoRoot),
    count: entries.length,
    entries,
  };
}

/**
 * Write a package to disk. Default path is
 * `.mneme/genome-pool/contribution-<timestamp>.json` so successive
 * runs don't overwrite each other.
 */
export function writePackage(repoRoot: string, pkg: GenomePoolPackage, outPath?: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = outPath ?? join(repoRoot, ".mneme/genome-pool", `contribution-${ts}.json`);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(pkg, null, 2), "utf8");
  return path;
}

/**
 * Quick-look summary: how many chromosomes this repo would
 * contribute, redaction count, hash list. The user reviews this
 * before deciding to upload.
 */
export function packageSummary(pkg: GenomePoolPackage): string {
  const lines: string[] = [];
  lines.push(`Genome Pool contribution`);
  lines.push(`  Generated:     ${pkg.generatedAt}`);
  lines.push(`  Repo finger:   ${pkg.repoFingerprint}`);
  lines.push(`  Chromosomes:   ${pkg.count}`);
  lines.push(``);
  lines.push(`First 5 entries (review before contributing):`);
  for (const e of pkg.entries.slice(0, 5)) {
    lines.push(`  [${e.hash}] (${e.vendor}) ${e.topic}`);
    lines.push(`    body excerpt: ${e.body.slice(0, 120).replace(/\n/g, " ")}`);
  }
  if (pkg.entries.length > 5) lines.push(`  ... and ${pkg.entries.length - 5} more.`);
  return lines.join("\n");
}
