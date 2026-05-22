/**
 * v2.24.0 — Persist HMAC-chained MCP fuzz report cards.
 *
 * Cards land at `.mneme/mcp_fuzzer/<seq>-<utc>.json` AND get appended to
 * an append-only ledger `.mneme/mcp_fuzzer/ledger.jsonl` (one line per
 * card with hmac + bodyDigest only — fast skim).
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ReportCard } from "./types.js";

function dirOf(repoRoot: string): string {
  return join(repoRoot, ".mneme", "mcp_fuzzer");
}

export function storeReport(repoRoot: string, card: ReportCard): { path: string; ledger: string } {
  const dir = dirOf(repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = card.finishedAt.replace(/[:.]/g, "-");
  const path = join(dir, `${String(card.seq).padStart(10, "0")}-${stamp}.json`);
  writeFileSync(path, JSON.stringify(card, null, 2) + "\n");
  const ledger = join(dir, "ledger.jsonl");
  const skim = {
    seq: card.seq,
    finishedAt: card.finishedAt,
    pass: card.summary.pass,
    fail: card.summary.fail,
    warn: card.summary.warn,
    trafficLight: card.wisdom.trafficLight,
    headline: card.wisdom.headline,
    hmac: card.hmac,
    bodyDigest: card.bodyDigest,
    file: path,
  };
  appendFileSync(ledger, JSON.stringify(skim) + "\n");
  return { path, ledger };
}

export function readLatestReport(repoRoot: string): ReportCard | null {
  const dir = dirOf(repoRoot);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  if (files.length === 0) return null;
  const last = files[files.length - 1]!;
  try {
    return JSON.parse(readFileSync(join(dir, last), "utf8")) as ReportCard;
  } catch {
    return null;
  }
}

export interface LedgerEntry {
  seq: number;
  finishedAt: string;
  pass: number;
  fail: number;
  warn: number;
  trafficLight: "green" | "yellow" | "red" | "black";
  headline: string;
  hmac: string;
  bodyDigest: string;
  file: string;
}

export function listReports(repoRoot: string, limit = 30): LedgerEntry[] {
  const ledger = join(dirOf(repoRoot), "ledger.jsonl");
  if (!existsSync(ledger)) return [];
  const lines = readFileSync(ledger, "utf8").split("\n").filter(Boolean);
  const out: LedgerEntry[] = [];
  for (const l of lines.slice(-limit)) {
    try { out.push(JSON.parse(l) as LedgerEntry); } catch { /* skip */ }
  }
  return out;
}
