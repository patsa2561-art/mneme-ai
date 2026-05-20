/**
 * v2.19.88 — #4 PROVENANCE GRAPH (git blame for AI-generated lines).
 *
 * Every time an AI suggests code that the user accepts, Mneme records:
 *   (file, lineRange, vendor, prompt, ts, polygraph-verdict)
 *
 * `mneme blame <file>:<line>` walks the ledger and shows which vendor +
 * which prompt generated that line, plus its polygraph verdict at the
 * time of insertion. HMAC-chained per-machine.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const DIR = ".mneme/provenance";
const LEDGER = "lines.jsonl";
const KEY = "prov.key";

export interface ProvenanceRecord {
  ts: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  vendor: string;
  promptHash: string;
  polygraphVerdict?: "green" | "yellow" | "red" | "grey";
  contentHash: string;
  chainHash?: string;
}

function ensureKey(repoRoot: string): string {
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, KEY);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function lastChain(repoRoot: string): string {
  const p = join(repoRoot, DIR, LEDGER);
  if (!existsSync(p)) return "GENESIS";
  const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]!) as ProvenanceRecord;
      if (obj.chainHash) return obj.chainHash;
    } catch { /* */ }
  }
  return "GENESIS";
}

function hash(s: string): string {
  return createHmac("sha256", "mneme-prov-hash").update(s).digest("base64url").slice(0, 12);
}

export interface RecordInput {
  file: string;
  lineStart: number;
  lineEnd: number;
  vendor: string;
  prompt: string;
  content: string;
  polygraphVerdict?: "green" | "yellow" | "red" | "grey";
}

export function recordProvenance(repoRoot: string, input: RecordInput): ProvenanceRecord {
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const key = ensureKey(repoRoot);
  const prev = lastChain(repoRoot);
  const ts = new Date().toISOString();
  const promptHash = hash(input.prompt);
  const contentHash = hash(input.content);
  const payload = `${prev}|${ts}|${input.file}|${input.lineStart}-${input.lineEnd}|${input.vendor}|${promptHash}|${contentHash}`;
  const chainHash = createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
  const rec: ProvenanceRecord = {
    ts, file: input.file, lineStart: input.lineStart, lineEnd: input.lineEnd,
    vendor: input.vendor, promptHash, polygraphVerdict: input.polygraphVerdict,
    contentHash, chainHash,
  };
  appendFileSync(join(repoRoot, DIR, LEDGER), JSON.stringify(rec) + "\n", "utf8");
  return rec;
}

export function blame(repoRoot: string, file: string, line: number): ProvenanceRecord[] {
  const p = join(repoRoot, DIR, LEDGER);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  const matches: ProvenanceRecord[] = [];
  for (const ln of lines) {
    try {
      const r = JSON.parse(ln) as ProvenanceRecord;
      if (r.file !== file) continue;
      if (line >= r.lineStart && line <= r.lineEnd) matches.push(r);
    } catch { /* */ }
  }
  matches.reverse();
  return matches;
}

export function listProvenance(repoRoot: string, opts: { limit?: number } = {}): ProvenanceRecord[] {
  const p = join(repoRoot, DIR, LEDGER);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  const out: ProvenanceRecord[] = [];
  for (const ln of lines) {
    try { out.push(JSON.parse(ln) as ProvenanceRecord); } catch { /* */ }
  }
  out.reverse();
  return typeof opts.limit === "number" ? out.slice(0, opts.limit) : out;
}
