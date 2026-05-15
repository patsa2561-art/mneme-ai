/**
 * v2.14.0 — KILL SWITCH PROTOCOL
 *
 *   "Three things every CISO loses sleep over:
 *      1. AI hallucinates → costly decision → lawsuit
 *      2. AI vendor changes pricing/TOS → migration nightmare
 *      3. AI exfiltrates secrets/PII → data breach
 *    Mneme answers all three with one bundle."
 *
 * Three layered defenses, each HMAC-signed for court-admissible audit:
 *
 *   1. KILL SWITCH — admin-issued signed directive that, when broadcast,
 *      tells every Mneme-aware AI agent to refuse to respond. Stamped
 *      with HMAC; receivers verify before honouring (so attackers can't
 *      forge a kill).
 *
 *   2. AUDIT LOG — every AI interaction is recorded with HMAC chain
 *      (similar to BOUNTY's structure but broader scope: prompts,
 *      responses, file accesses, tool calls). Tamper-evident.
 *
 *   3. DLP (Data Leakage Prevention) — scan outbound AI prompts /
 *      responses for secrets / PII patterns BEFORE they leave the org.
 *      Block + log violations.
 *
 * Storage: `.mneme/compliance/` directory:
 *   - kill_switch.json  — current state of the kill directive
 *   - audit.jsonl       — append-only audit chain
 *   - dlp_rules.json    — current rule set (org can override defaults)
 *
 * Composes orthogonally with existing `aegis/` (immune system) and
 * `ai_compliance.ts` (compliance metrics) — those measure; KILL SWITCH
 * acts.
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

const PROTOCOL_VERSION = 1 as const;

// ====================================================================
// KILL SWITCH
// ====================================================================

export interface KillSwitchDirective {
  v: typeof PROTOCOL_VERSION;
  /** "active" = refuse all AI. "scoped" = refuse for specific tags. "off" = normal. */
  state: "active" | "scoped" | "off";
  /** Free-form reason for the kill. */
  reason: string;
  /** Issuer identity (e.g., "ciso@company.com"). */
  issuedBy: string;
  issuedAt: string;
  /** Optional scopes — when state="scoped", only these vendors / tags are killed. */
  scopes?: {
    vendors?: string[];
    tags?: string[];
  };
  /** Optional expiry — auto-clears at this time. */
  expiresAt?: string;
  /** HMAC over the directive body. */
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_COMPLIANCE_SECRET"] || `mneme-compliance-v${PROTOCOL_VERSION}`;
}

function complianceDir(repoDir?: string): string {
  const root = repoDir ? (isAbsolute(repoDir) ? repoDir : resolve(repoDir)) : process.cwd();
  const dir = join(root, ".mneme", "compliance");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function signDirective(body: Omit<KillSwitchDirective, "sig">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

export interface IssueKillInput {
  state: "active" | "scoped" | "off";
  reason: string;
  issuedBy: string;
  scopes?: KillSwitchDirective["scopes"];
  expiresAt?: string;
  repoDir?: string;
  secret?: string;
}

export function issueKillSwitch(input: IssueKillInput): KillSwitchDirective {
  const dir = complianceDir(input.repoDir);
  const noSig: Omit<KillSwitchDirective, "sig"> = {
    v: PROTOCOL_VERSION,
    state: input.state,
    reason: input.reason.slice(0, 1000),
    issuedBy: input.issuedBy,
    issuedAt: new Date().toISOString(),
    ...(input.scopes ? { scopes: input.scopes } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
  const directive: KillSwitchDirective = { ...noSig, sig: signDirective(noSig, input.secret ?? defaultSecret()) };
  writeFileSync(join(dir, "kill_switch.json"), JSON.stringify(directive, null, 2));
  recordAudit({
    kind: "kill_switch",
    actor: input.issuedBy,
    detail: `kill switch ${input.state}: ${input.reason}`,
    repoDir: input.repoDir,
    secret: input.secret,
  });
  return directive;
}

export function readKillSwitch(opts: { repoDir?: string } = {}): KillSwitchDirective | null {
  const path = join(complianceDir(opts.repoDir), "kill_switch.json");
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as KillSwitchDirective; } catch { return null; }
}

export function verifyKillSwitch(d: KillSwitchDirective, secret?: string): { ok: boolean; reason?: string } {
  const { sig: claimed, ...body } = d as KillSwitchDirective & { sig: string };
  const expected = signDirective(body, secret ?? defaultSecret());
  try {
    const ok = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex"));
    return ok ? { ok: true } : { ok: false, reason: "directive sig mismatch — forged or tampered" };
  } catch { return { ok: false, reason: "directive sig length invalid" }; }
}

export interface ShouldRespondInput {
  vendor?: string;
  tags?: string[];
  repoDir?: string;
  secret?: string;
}

/**
 * The runtime check. Mneme-aware AI clients call this before every
 * response. If kill switch is active (or scoped to them), they MUST
 * refuse. Returns an instruction to embed in the refusal.
 */
export function shouldRespond(input: ShouldRespondInput = {}): {
  allowed: boolean;
  reason?: string;
  killDirective?: KillSwitchDirective;
} {
  const d = readKillSwitch({ repoDir: input.repoDir });
  if (!d) return { allowed: true };
  // Verify before honouring (so attackers can't forge a kill).
  const v = verifyKillSwitch(d, input.secret);
  if (!v.ok) return { allowed: true, reason: `ignoring unverified directive: ${v.reason}` };
  // Check expiry.
  if (d.expiresAt && new Date(d.expiresAt).getTime() < Date.now()) return { allowed: true };
  if (d.state === "off") return { allowed: true };
  if (d.state === "active") return { allowed: false, reason: d.reason, killDirective: d };
  if (d.state === "scoped" && d.scopes) {
    if (input.vendor && d.scopes.vendors?.includes(input.vendor)) return { allowed: false, reason: d.reason, killDirective: d };
    if (input.tags && d.scopes.tags?.some((t) => input.tags!.includes(t))) return { allowed: false, reason: d.reason, killDirective: d };
  }
  return { allowed: true };
}

// ====================================================================
// AUDIT LOG (HMAC-chained, court-admissible)
// ====================================================================

export interface AuditEntry {
  v: typeof PROTOCOL_VERSION;
  id: string;
  ts: string;
  kind: "prompt" | "response" | "tool_call" | "file_read" | "kill_switch" | "dlp_block" | "other";
  actor: string;
  detail: string;
  /** Optional metadata (vendor, tool name, hash of content, etc). */
  meta?: Record<string, string | number | boolean>;
  /** chainSig = HMAC(prev.chainSig + canonical(this)). */
  chainSig: string;
}

function auditPath(repoDir?: string): string {
  return join(complianceDir(repoDir), "audit.jsonl");
}

function readAudit(repoDir?: string): AuditEntry[] {
  const p = auditPath(repoDir);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: AuditEntry[] = [];
  for (const l of lines) { try { out.push(JSON.parse(l)); } catch {} }
  return out;
}

function lastChain(repoDir?: string): string {
  const all = readAudit(repoDir);
  return all.length === 0 ? "" : all[all.length - 1]!.chainSig;
}

export interface RecordAuditInput {
  kind: AuditEntry["kind"];
  actor: string;
  detail: string;
  meta?: AuditEntry["meta"];
  repoDir?: string;
  secret?: string;
}

export function recordAudit(input: RecordAuditInput): AuditEntry {
  const prev = lastChain(input.repoDir);
  const noSig: Omit<AuditEntry, "chainSig"> = {
    v: PROTOCOL_VERSION,
    id: "a-" + randomBytes(6).toString("hex"),
    ts: new Date().toISOString(),
    kind: input.kind,
    actor: input.actor,
    detail: input.detail.slice(0, 2000),
    ...(input.meta ? { meta: input.meta } : {}),
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret())
    .update(prev + canon(noSig)).digest("hex");
  const entry: AuditEntry = { ...noSig, chainSig: sig };
  appendFileSync(auditPath(input.repoDir), JSON.stringify(entry) + "\n");
  return entry;
}

export function verifyAuditChain(opts: { repoDir?: string; secret?: string } = {}): {
  ok: boolean; total: number; brokenIndex: number; brokenReason?: string;
} {
  const all = readAudit(opts.repoDir);
  const sec = opts.secret ?? defaultSecret();
  let prev = "";
  for (let i = 0; i < all.length; i++) {
    const { chainSig: claimed, ...body } = all[i] as AuditEntry & { chainSig: string };
    const expected = createHmac("sha256", sec).update(prev + canon(body)).digest("hex");
    if (expected !== claimed) return { ok: false, total: all.length, brokenIndex: i, brokenReason: `chainSig mismatch at ${i}` };
    prev = claimed;
  }
  return { ok: true, total: all.length, brokenIndex: -1 };
}

/** Export the audit log for compliance reporting (CISO weekly etc). */
export function exportAuditReport(opts: { repoDir?: string; since?: string } = {}): {
  entries: AuditEntry[];
  total: number;
  byKind: Record<string, number>;
  byActor: Record<string, number>;
  generatedAt: string;
  chainOk: boolean;
} {
  const all = readAudit(opts.repoDir);
  const since = opts.since ? new Date(opts.since).getTime() : 0;
  const filtered = all.filter((e) => new Date(e.ts).getTime() >= since);
  const byKind: Record<string, number> = {};
  const byActor: Record<string, number> = {};
  for (const e of filtered) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    byActor[e.actor] = (byActor[e.actor] ?? 0) + 1;
  }
  const chain = verifyAuditChain({ repoDir: opts.repoDir });
  return {
    entries: filtered,
    total: filtered.length,
    byKind, byActor,
    generatedAt: new Date().toISOString(),
    chainOk: chain.ok,
  };
}

// ====================================================================
// DLP (Data Leakage Prevention)
// ====================================================================

export interface DlpRule {
  id: string;
  pattern: string; // regex source
  flags?: string;
  severity: "warn" | "block";
  category: "secret" | "pii" | "credential" | "internal" | "other";
  description: string;
}

const BUILTIN_RULES: DlpRule[] = [
  { id: "aws-access-key", pattern: "AKIA[0-9A-Z]{16}", flags: "g", severity: "block", category: "secret", description: "AWS Access Key ID" },
  { id: "aws-secret-key", pattern: "(?<![A-Za-z0-9])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9])", flags: "g", severity: "warn", category: "secret", description: "AWS Secret Access Key (heuristic; high FP rate)" },
  { id: "github-pat", pattern: "ghp_[A-Za-z0-9]{36,}", flags: "g", severity: "block", category: "credential", description: "GitHub PAT" },
  { id: "openai-key", pattern: "sk-[A-Za-z0-9]{20,}", flags: "g", severity: "block", category: "credential", description: "OpenAI / Anthropic / generic sk- API key" },
  { id: "private-key", pattern: "-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----", flags: "g", severity: "block", category: "secret", description: "PEM private key block" },
  { id: "jwt", pattern: "eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+", flags: "g", severity: "warn", category: "credential", description: "JWT (base64 3-part)" },
  { id: "email", pattern: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", flags: "g", severity: "warn", category: "pii", description: "email address" },
  { id: "credit-card", pattern: "\\b(?:\\d[ -]?){13,19}\\b", flags: "g", severity: "block", category: "pii", description: "credit card number (Luhn not checked here)" },
  { id: "thai-id", pattern: "\\b\\d{1}[ -]?\\d{4}[ -]?\\d{5}[ -]?\\d{2}[ -]?\\d{1}\\b", flags: "g", severity: "block", category: "pii", description: "Thai national ID number" },
];

export interface DlpScanResult {
  hits: Array<{ ruleId: string; category: DlpRule["category"]; severity: "warn" | "block"; match: string; description: string }>;
  worstSeverity: "none" | "warn" | "block";
  blocked: boolean;
  scanned: number;
  signedAt: string;
  sig: string;
}

export function loadDlpRules(opts: { repoDir?: string } = {}): DlpRule[] {
  const root = opts.repoDir ? resolveOrCwd(opts.repoDir) : process.cwd();
  const path = join(root, ".mneme", "compliance", "dlp_rules.json");
  if (existsSync(path)) {
    try {
      const custom = JSON.parse(readFileSync(path, "utf8")) as { rules: DlpRule[] };
      return [...BUILTIN_RULES, ...(custom.rules ?? [])];
    } catch { /* fall through to builtin only */ }
  }
  return [...BUILTIN_RULES];
}

function resolveOrCwd(p: string): string {
  return isAbsolute(p) ? p : resolve(p);
}

/**
 * Scan a string for DLP violations. Returns hits + verdict. Calls
 * recordAudit("dlp_block") when blocking — court-admissible trace.
 */
export function dlpScan(text: string, opts: { repoDir?: string; actor?: string; secret?: string } = {}): DlpScanResult {
  const rules = loadDlpRules(opts);
  const hits: DlpScanResult["hits"] = [];
  for (const rule of rules) {
    try {
      const re = new RegExp(rule.pattern, rule.flags ?? "");
      const matches = text.match(re);
      if (matches) {
        for (const m of matches.slice(0, 5)) {
          hits.push({
            ruleId: rule.id,
            category: rule.category,
            severity: rule.severity,
            match: m.length > 60 ? m.slice(0, 30) + "…" + m.slice(-20) : m,
            description: rule.description,
          });
        }
      }
    } catch { /* malformed user rule — skip */ }
  }
  let worst: DlpScanResult["worstSeverity"] = "none";
  for (const h of hits) {
    if (h.severity === "block") { worst = "block"; break; }
    if (h.severity === "warn") worst = "warn";
  }
  const blocked = worst === "block";
  const signedAt = new Date().toISOString();
  const body = { hits: hits.length, worst, blocked, scanned: text.length, signedAt };
  const sig = createHmac("sha256", opts.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  if (blocked) {
    recordAudit({
      kind: "dlp_block",
      actor: opts.actor ?? "unknown",
      detail: `DLP blocked: ${hits.filter((h) => h.severity === "block").map((h) => h.ruleId).join(",")}`,
      meta: { hitCount: hits.length },
      repoDir: opts.repoDir,
      secret: opts.secret,
    });
  }
  return { hits, worstSeverity: worst, blocked, scanned: text.length, signedAt, sig };
}

/** One-line pulse summary. */
export function formatCompliancePulse(opts: { repoDir?: string } = {}): string {
  const k = readKillSwitch(opts);
  const audit = readAudit(opts.repoDir);
  const killTag = k ? `kill=${k.state}` : "kill=off";
  return `COMPLIANCE · ${killTag} · audit=${audit.length}`;
}
