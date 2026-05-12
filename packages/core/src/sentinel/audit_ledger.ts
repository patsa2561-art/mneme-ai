/**
 * v1.71.0 -- SENTINEL S4: HMAC AUDIT LEDGER.
 *
 * Every detected dangerous command is logged with HMAC signature so
 * the audit trail is tamper-evident. The "black box" of AI actions:
 * if an AI ever does something irreversibly bad, the ledger shows
 * exactly which command + when + risk score.
 *
 * Storage: .mneme/sentinel/audit.jsonl
 * Secret:  .mneme/sentinel/secret  (random 32 bytes, per-repo)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";

import type { RecommendedAction, RiskScoreReport } from "./risk_scorer.js";

const SENTINEL_DIR = ".mneme/sentinel";
const AUDIT_LOG = ".mneme/sentinel/audit.jsonl";
const SECRET_FILE = ".mneme/sentinel/secret";

export interface AuditEntry {
  id: string;
  ts: string;
  command: string;
  score: number;
  action: RecommendedAction;
  /** Class labels that fired. */
  classes: string[];
  /** Vendor (AI agent) that proposed the command. */
  vendor: string;
  /** Whether the command actually ran (caller flips this AFTER decision). */
  executed: boolean;
  /** HMAC over canonical payload. */
  hmac: string;
}

function ensureSecret(repoRoot: string): string {
  const p = join(repoRoot, SECRET_FILE);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const dir = join(repoRoot, SENTINEL_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const s = randomBytes(32).toString("hex");
  try { writeFileSync(p, s, "utf8"); } catch { /* */ }
  return s;
}

function canonical(payload: Omit<AuditEntry, "hmac" | "id">): string {
  return JSON.stringify({
    ts: payload.ts,
    command: payload.command,
    score: payload.score,
    action: payload.action,
    classes: [...payload.classes].sort(),
    vendor: payload.vendor,
    executed: payload.executed,
  });
}

export interface AuditOptions {
  vendor?: string;
  executed?: boolean;
}

export function appendAudit(repoRoot: string, command: string, report: RiskScoreReport, opts?: AuditOptions): AuditEntry {
  const secret = ensureSecret(repoRoot);
  const ts = new Date().toISOString();
  const payload: Omit<AuditEntry, "hmac" | "id"> = {
    ts,
    command: command.slice(0, 500),
    score: report.score,
    action: report.recommendedAction,
    classes: report.detection.classes,
    vendor: opts?.vendor ?? "unknown",
    executed: opts?.executed ?? false,
  };
  const canon = canonical(payload);
  const hmac = createHmac("sha256", secret).update(canon).digest("hex");
  const id = createHash("sha256").update(canon).digest("hex").slice(0, 16);
  const entry: AuditEntry = { ...payload, id, hmac };
  try {
    const dir = join(repoRoot, SENTINEL_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(repoRoot, AUDIT_LOG), JSON.stringify(entry) + "\n", "utf8");
  } catch { /* */ }
  return entry;
}

export type VerifyVerdict = "VALID" | "INVALID_HMAC" | "NOT_FOUND";

export function verifyAuditEntry(repoRoot: string, entry: AuditEntry): VerifyVerdict {
  const secret = ensureSecret(repoRoot);
  const expected = createHmac("sha256", secret).update(canonical(entry)).digest("hex");
  if (expected !== entry.hmac) return "INVALID_HMAC";
  return "VALID";
}

export function readAuditLog(repoRoot: string): AuditEntry[] {
  const p = join(repoRoot, AUDIT_LOG);
  if (!existsSync(p)) return [];
  const out: AuditEntry[] = [];
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as AuditEntry); } catch { /* */ }
    }
  } catch { /* */ }
  return out;
}

export interface AuditSummary {
  total: number;
  byAction: Record<RecommendedAction, number>;
  byClass: Record<string, number>;
  byVendor: Record<string, number>;
  tamperedCount: number;
  lastEntry: AuditEntry | null;
  headline: string;
}

export function summarizeAudit(repoRoot: string): AuditSummary {
  const entries = readAuditLog(repoRoot);
  const byAction: Record<RecommendedAction, number> = { ALLOW: 0, AUDIT: 0, WARN: 0, BLOCK: 0 };
  const byClass: Record<string, number> = {};
  const byVendor: Record<string, number> = {};
  let tampered = 0;
  for (const e of entries) {
    byAction[e.action] = (byAction[e.action] ?? 0) + 1;
    for (const c of e.classes) byClass[c] = (byClass[c] ?? 0) + 1;
    byVendor[e.vendor] = (byVendor[e.vendor] ?? 0) + 1;
    if (verifyAuditEntry(repoRoot, e) === "INVALID_HMAC") tampered += 1;
  }
  return {
    total: entries.length,
    byAction, byClass, byVendor,
    tamperedCount: tampered,
    lastEntry: entries[entries.length - 1] ?? null,
    headline: `${entries.length} audit entry/ies (${tampered} tampered). BLOCK=${byAction.BLOCK}, WARN=${byAction.WARN}, AUDIT=${byAction.AUDIT}.`,
  };
}
