/**
 * v2.19.87 — #8 AI WHISTLEBLOWER MODE.
 *
 * Mneme stays loyal to the USER, not the AI vendor.  When the AI you're
 * talking to suggests something illegal / non-compliant / dangerous /
 * leaks PII, the whistleblower flags it BEFORE you act on it.
 *
 * Detection axes:
 *   1. Dangerous commands       (rm -rf, force-push to main, --no-verify,
 *                                drop database, git reset --hard)
 *   2. License contamination    (suggested code with copyright headers
 *                                from incompatible licenses)
 *   3. PII / secrets leakage    (reuses compliance.dlp patterns —
 *                                AWS / GitHub / OpenAI / JWT / PEM /
 *                                Thai national ID / cards / email)
 *   4. Compliance evasion       (phrases like "let's bypass review",
 *                                "as per company policy" mid-suggestion,
 *                                "I cannot disclose ... but the answer is")
 *   5. Self-incrimination       (AI admitting it doesn't have access,
 *                                guessing without saying so, etc)
 *
 * Every flagged incident is appended to .mneme/whistleblower/incidents.jsonl
 * HMAC-chained — tamper-evident audit log for compliance officers.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const DIR = ".mneme/whistleblower";
const LEDGER = "incidents.jsonl";
const KEY_FILE = "whistle.key";

export type IncidentSeverity = "info" | "warn" | "block";
export type IncidentClass =
  | "dangerous_command"
  | "license_contamination"
  | "pii_leak"
  | "secret_leak"
  | "compliance_evasion"
  | "self_incrimination";

export interface Incident {
  ts: string;
  vendor: string;
  class: IncidentClass;
  severity: IncidentSeverity;
  evidence: string;     // matched substring (truncated)
  context: string;      // surrounding 60 chars
  rationale: string;    // why this is suspect
  chainHash?: string;
}

export interface WhistleScanResult {
  incidents: Incident[];
  /** Overall verdict: clean / advise / block. */
  verdict: "clean" | "advise" | "block";
  /** Plain-English summary for the user. */
  summary: string;
}

// ─── DETECTORS ──────────────────────────────────────────────────────────

interface Detector {
  cls: IncidentClass;
  severity: IncidentSeverity;
  rationale: string;
  pattern: RegExp;
}

const DETECTORS: Detector[] = [
  // 1. Dangerous shell commands
  { cls: "dangerous_command", severity: "block", rationale: "Recursive force-delete suggested — irreversible.", pattern: /\brm\s+-rf\s+[\/~]/i },
  { cls: "dangerous_command", severity: "block", rationale: "Force-push to a protected branch suggested.", pattern: /git\s+push\s+(--force|-f)\b.*\b(main|master|trunk|production)/i },
  { cls: "dangerous_command", severity: "warn",  rationale: "Hard reset will destroy uncommitted work.", pattern: /git\s+reset\s+--hard/i },
  { cls: "dangerous_command", severity: "warn",  rationale: "Skipping pre-commit hooks bypasses safety gates.", pattern: /git\s+commit\s+[^\n]*--no-verify/i },
  { cls: "dangerous_command", severity: "block", rationale: "Dropping a database table or schema.", pattern: /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i },
  { cls: "dangerous_command", severity: "warn",  rationale: "Piping curl into sudo bash is the canonical supply-chain attack vector.", pattern: /curl\s+[^|]+\|\s*(sudo\s+)?(ba)?sh/i },
  { cls: "dangerous_command", severity: "warn",  rationale: "chmod 777 grants world-write — security smell.", pattern: /chmod\s+(-R\s+)?777/i },
  // 2. License contamination signatures
  { cls: "license_contamination", severity: "warn", rationale: "GPL header in suggested code may conflict with MIT/Apache project.", pattern: /GNU\s+General\s+Public\s+License|GPL[v]?[23]/ },
  { cls: "license_contamination", severity: "warn", rationale: "Suggested code carries a proprietary 'all rights reserved' header.", pattern: /Copyright\s+\([cC]\).*all\s+rights\s+reserved/i },
  // 3. PII / secrets — overlap with compliance.dlp but kept inline so this
  //    module stays self-sufficient.
  { cls: "secret_leak", severity: "block", rationale: "AWS access key in AI output.", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { cls: "secret_leak", severity: "block", rationale: "GitHub personal access token in AI output.", pattern: /\bgh[pous]_[A-Za-z0-9_]{36,}\b/ },
  { cls: "secret_leak", severity: "block", rationale: "OpenAI / Anthropic API key in AI output.", pattern: /\b(sk-[A-Za-z0-9]{32,}|sk-ant-api\d{2}-[A-Za-z0-9_-]{60,})\b/ },
  { cls: "secret_leak", severity: "block", rationale: "Private key block embedded in AI output.", pattern: /-----BEGIN\s+(RSA|EC|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----/ },
  { cls: "pii_leak", severity: "warn", rationale: "Thai national ID number (13-digit) embedded in AI output.", pattern: /\b[0-9]-[0-9]{4}-[0-9]{5}-[0-9]{2}-[0-9]\b/ },
  { cls: "pii_leak", severity: "warn", rationale: "Credit-card-like number in AI output.", pattern: /\b(?:\d[ -]*?){13,19}\b/ },
  // 4. Compliance evasion phrases
  { cls: "compliance_evasion", severity: "block", rationale: "AI is suggesting a workaround to bypass review.", pattern: /\b(bypass|skip|work\s*around)\s+(the\s+)?(review|hook|gate|approval)/i },
  { cls: "compliance_evasion", severity: "warn",  rationale: "AI invoked a policy without citing the policy.", pattern: /\bas\s+per\s+(company|corporate)\s+policy\b/i },
  { cls: "compliance_evasion", severity: "warn",  rationale: "AI claimed it cannot disclose, then offered to disclose anyway.", pattern: /i\s+(cannot|can't|am\s+not\s+able\s+to)\s+disclose[^.]*(but|however)\b/i },
  // 5. Self-incrimination / hedge-without-saying-so
  { cls: "self_incrimination", severity: "info", rationale: "AI is guessing without flagging uncertainty.", pattern: /\b(probably|might\s+be|most\s+likely)\s+\d/i },
];

export function scanWhistle(text: string, opts: { vendor?: string } = {}): Incident[] {
  if (!text) return [];
  const out: Incident[] = [];
  for (const d of DETECTORS) {
    const m = d.pattern.exec(text);
    if (!m) continue;
    const i = m.index ?? text.indexOf(m[0]);
    const ctxStart = Math.max(0, i - 30);
    const ctxEnd = Math.min(text.length, i + m[0].length + 30);
    out.push({
      ts: new Date().toISOString(),
      vendor: opts.vendor ?? "unknown",
      class: d.cls,
      severity: d.severity,
      evidence: m[0].slice(0, 80),
      context: text.slice(ctxStart, ctxEnd),
      rationale: d.rationale,
    });
  }
  return out;
}

function ensureKey(repoRoot: string): string {
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, KEY_FILE);
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
      const obj = JSON.parse(lines[i]!) as Incident;
      if (obj.chainHash) return obj.chainHash;
    } catch { /* */ }
  }
  return "GENESIS";
}

/** Append incidents to the HMAC-chained ledger and return them with sigs. */
export function recordIncidents(repoRoot: string, incidents: Incident[]): Incident[] {
  if (incidents.length === 0) return [];
  const key = ensureKey(repoRoot);
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let prev = lastChain(repoRoot);
  const out: Incident[] = [];
  for (const inc of incidents) {
    const payload = `${prev}|${inc.ts}|${inc.vendor}|${inc.class}|${inc.severity}|${inc.evidence}`;
    const chainHash = createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
    const stamped: Incident = { ...inc, chainHash };
    appendFileSync(join(repoRoot, DIR, LEDGER), JSON.stringify(stamped) + "\n", "utf8");
    out.push(stamped);
    prev = chainHash;
  }
  return out;
}

export function scanWhistleAndRecord(repoRoot: string, text: string, opts: { vendor?: string } = {}): WhistleScanResult {
  const incidents = scanWhistle(text, opts);
  const recorded = recordIncidents(repoRoot, incidents);
  const hasBlock = recorded.some((i) => i.severity === "block");
  const hasWarn = recorded.some((i) => i.severity === "warn");
  const verdict: WhistleScanResult["verdict"] = hasBlock ? "block" : hasWarn ? "advise" : "clean";
  const summary = verdict === "block"
    ? `🚨 ${recorded.length} incidents (${recorded.filter((i) => i.severity === "block").length} blocking). Do NOT act on this AI output.`
    : verdict === "advise"
      ? `⚠ ${recorded.length} incidents found. Review before acting.`
      : "✓ Clean — no compliance flags raised.";
  return { incidents: recorded, verdict, summary };
}

export function readIncidents(repoRoot: string, opts: { limit?: number; sinceTs?: number } = {}): Incident[] {
  const p = join(repoRoot, DIR, LEDGER);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  const out: Incident[] = [];
  for (const line of lines) {
    try {
      const inc = JSON.parse(line) as Incident;
      if (opts.sinceTs && Date.parse(inc.ts) < opts.sinceTs) continue;
      out.push(inc);
    } catch { /* */ }
  }
  out.reverse();
  return typeof opts.limit === "number" ? out.slice(0, opts.limit) : out;
}
