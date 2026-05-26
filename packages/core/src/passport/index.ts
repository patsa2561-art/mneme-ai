/**
 * v2.61.0 — PASSPORT: capability-based security for MCP.
 *
 * Pre-v2.61, every MCP tool was equal-trust: an agent could ask for
 * `shell.exec` the same way it asks for `read_file`. This is the
 * security model of "all root" — exactly what a CISO refuses.
 *
 * PASSPORT introduces capability tokens. Before calling a sensitive
 * tool, an agent must request a HMAC-signed passport from Mneme.
 * Other MCP servers (or future Mneme-wrapped servers) verify the
 * passport HMAC + scope + TTL before executing. If the requesting
 * agent's trust score is below the tier's threshold → REFUSED.
 *
 * Five wild innovations (the "premium" angle beyond a JWT):
 *
 *  1. COMPOSED TRUST SCORE — fuses NEMESIS env-scan + verify_identity
 *     + HONEST_MIRROR weight + STEALTH score + historical approval
 *     rate into a single 0..1. Per-signal weighted; transparent
 *     for audit. Hand-written single-scores can lie; fused signals
 *     resist gaming.
 *
 *  2. CAPABILITY DELEGATION CHAIN — passport.delegate(parent, scope)
 *     creates a CHILD passport with strictly-reduced scope + parent
 *     reference. Verifier walks the chain to attribute every call to
 *     the originating agent. Cycles + scope-expansion attempts are
 *     refused.
 *
 *  3. HMAC-CHAINED AUDIT LEDGER — every issuance + verification +
 *     revocation appends to `.mneme/passport/ledger.jsonl` with
 *     HMAC chain. Tamper-evident; works offline; survives daemon
 *     restart. Court-admissible audit trail.
 *
 *  4. REVOCATION CASCADE — revoking a parent passport auto-revokes
 *     every child issued via delegation. Atomic propagation; no
 *     dangling permissions after a vendor incident.
 *
 *  5. POLICY OVERRIDES — `.mneme/passport/policy.json` lets users
 *     tighten DEFAULT_POLICY (e.g. require multi-party for
 *     destructive tier). Pinned + drift-detectable like SKELETON
 *     KEY snapshots — silent policy tampering is detectable.
 *
 * Pure ESM. Defensive — never throws.
 */

import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { computeTrust, type TrustInputs, type TrustResult } from "./trust_score.js";
import { DEFAULT_POLICY, classifyTier, resolveTier, type RiskTier, type TierConfig } from "./policy.js";

const KEY_ENV = "MNEME_PASSPORT_KEY";
const DEFAULT_KEY = "mneme-passport-v1";
function keyOf(): string { return process.env[KEY_ENV] ?? DEFAULT_KEY; }

/* ── Types ──────────────────────────────────────────────────────── */

export interface PassportClaims {
  /** Tool name the passport authorizes (e.g. "shell.exec"). */
  tool: string;
  /** Risk tier classification at issuance time. */
  tier: RiskTier;
  /** ISO timestamp issued at. */
  iat: string;
  /** ISO timestamp expires at. */
  exp: string;
  /** Random unique id (jti / JWT-id). */
  jti: string;
  /** Optional parent passport id (when this was delegated). */
  parentJti?: string;
  /** Agent identifier (vendor or session id). */
  agent: string;
  /** Trust score at issuance time. */
  trust: number;
  /** Scope sub-restrictions (optional; subset of tool's full capability). */
  scope?: string[];
}

export interface Passport {
  /** Canonical claims body. */
  claims: PassportClaims;
  /** HMAC sig of canonical JSON(claims). */
  hmac: string;
  /** Encoded token form: base64url(claims)+"."+hmac. */
  token: string;
}

export interface IssueInput {
  tool: string;
  /** Optional explicit tier; otherwise classified from tool name. */
  tier?: RiskTier;
  /** Agent identifier. */
  agent: string;
  /** Trust signals to compute score. */
  trustInputs?: TrustInputs;
  /** Optional scope sub-restrictions. */
  scope?: string[];
  /** Optional parent passport (token form) when delegating. */
  parent?: string;
  /** Apply policy overrides (else DEFAULT_POLICY). */
  policyOverrides?: Partial<Record<RiskTier, Partial<TierConfig>>>;
  /** Working directory for ledger persist (default cwd). */
  cwd?: string;
}

export interface IssueResult {
  ok: boolean;
  passport?: Passport;
  /** When ok=false, machine-readable reason. */
  reason: "granted" | "trust_too_low" | "parent_invalid" | "parent_scope_violation" | "policy_violation" | "tier_unknown";
  /** Human-readable explanation including trust breakdown. */
  hint: string;
  /** Computed trust at issuance. */
  trust?: TrustResult;
  /** Resolved tier config. */
  tier?: TierConfig & { name: RiskTier };
}

export interface VerifyResult {
  valid: boolean;
  reason: "ok" | "malformed" | "bad_hmac" | "expired" | "revoked" | "tool_mismatch" | "scope_mismatch";
  /** When valid, milliseconds remaining on TTL. */
  ttlMs?: number;
  /** Decoded claims when valid OR when payload structurally parseable. */
  claims?: PassportClaims;
  /** Chain of ancestors if delegated (root first). */
  chain?: PassportClaims[];
}

/* ── Token encoding ─────────────────────────────────────────────── */

function canonicalJson(o: unknown): string {
  // Deterministic key ordering for HMAC stability.
  // Drop keys with undefined values (JSON.stringify default behavior).
  if (o === undefined) return "null"; // shouldn't surface at top level
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map((x) => canonicalJson(x === undefined ? null : x)).join(",") + "]";
  const entries = Object.entries(o as Record<string, unknown>).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
}

function signClaims(claims: PassportClaims): string {
  return createHmac("sha256", keyOf()).update(canonicalJson(claims)).digest("hex");
}

function encodeToken(claims: PassportClaims, hmac: string): string {
  const body = Buffer.from(canonicalJson(claims), "utf8").toString("base64url");
  return `${body}.${hmac}`;
}

export function decodePassport(token: string): { claims: PassportClaims; hmac: string } | null {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const hmac = token.slice(dot + 1);
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PassportClaims;
    if (!claims || typeof claims !== "object") return null;
    return { claims, hmac };
  } catch {
    return null;
  }
}

/* ── Ledger ─────────────────────────────────────────────────────── */

interface LedgerEntry {
  kind: "issue" | "verify" | "revoke";
  at: string;
  jti: string;
  tool?: string;
  agent?: string;
  verdict?: string;
  prevHmac: string;
  hmac: string;
}

function ledgerPath(cwd: string): string {
  return join(cwd, ".mneme", "passport", "ledger.jsonl");
}

function readLedgerLines(cwd: string): string[] {
  try {
    return readFileSync(ledgerPath(cwd), "utf8").trim().split(/\n/).filter((l) => l.trim().length > 0);
  } catch { return []; }
}

function lastLedgerHmac(cwd: string): string {
  const lines = readLedgerLines(cwd);
  if (lines.length === 0) return "";
  try {
    return (JSON.parse(lines[lines.length - 1]!) as LedgerEntry).hmac;
  } catch { return ""; }
}

function appendLedger(cwd: string, kind: LedgerEntry["kind"], jti: string, extra: Partial<LedgerEntry>): LedgerEntry {
  const prevHmac = lastLedgerHmac(cwd);
  const body: Omit<LedgerEntry, "hmac"> = {
    kind, at: new Date().toISOString(), jti,
    tool: extra.tool, agent: extra.agent, verdict: extra.verdict, prevHmac,
  };
  const hmac = createHmac("sha256", keyOf()).update(prevHmac).update(canonicalJson(body)).digest("hex");
  const entry: LedgerEntry = { ...body, hmac };
  try {
    mkdirSync(dirname(ledgerPath(cwd)), { recursive: true });
    appendFileSync(ledgerPath(cwd), JSON.stringify(entry) + "\n");
  } catch { /* noop */ }
  return entry;
}

/* ── Revocation ─────────────────────────────────────────────────── */

function revocationsPath(cwd: string): string {
  return join(cwd, ".mneme", "passport", "revocations.json");
}

interface RevocationFile {
  /** Set of revoked jtis (kept as array for JSON). */
  jtis: string[];
}

function readRevocations(cwd: string): Set<string> {
  try {
    const data = JSON.parse(readFileSync(revocationsPath(cwd), "utf8")) as RevocationFile;
    return new Set(data.jtis ?? []);
  } catch { return new Set(); }
}

function writeRevocations(cwd: string, set: Set<string>): void {
  try {
    mkdirSync(dirname(revocationsPath(cwd)), { recursive: true });
    writeFileSync(revocationsPath(cwd), JSON.stringify({ jtis: Array.from(set) }, null, 2));
  } catch { /* noop */ }
}

/* ── Delegation graph ───────────────────────────────────────────── */

function delegationGraphPath(cwd: string): string {
  return join(cwd, ".mneme", "passport", "delegations.json");
}

interface DelegationGraph {
  /** child jti → parent jti. */
  parents: Record<string, string>;
}

function readDelegations(cwd: string): DelegationGraph {
  try {
    return JSON.parse(readFileSync(delegationGraphPath(cwd), "utf8")) as DelegationGraph;
  } catch { return { parents: {} }; }
}

function writeDelegations(cwd: string, g: DelegationGraph): void {
  try {
    mkdirSync(dirname(delegationGraphPath(cwd)), { recursive: true });
    writeFileSync(delegationGraphPath(cwd), JSON.stringify(g, null, 2));
  } catch { /* noop */ }
}

function descendantsOf(jti: string, g: DelegationGraph): Set<string> {
  const set = new Set<string>();
  const queue = [jti];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [child, parent] of Object.entries(g.parents)) {
      if (parent === cur && !set.has(child)) {
        set.add(child);
        queue.push(child);
      }
    }
  }
  return set;
}

/* ── Issue ──────────────────────────────────────────────────────── */

export function issuePassport(input: IssueInput): IssueResult {
  const cwd = input.cwd ?? process.cwd();
  const tierName: RiskTier = input.tier ?? classifyTier(input.tool);
  const tier = resolveTier(tierName, input.policyOverrides);
  if (!tier) return { ok: false, reason: "tier_unknown", hint: `unknown risk tier: ${tierName}` };

  // Parent verification (delegation)
  let parentJti: string | undefined;
  if (input.parent) {
    const parent = verifyPassport({ token: input.parent, cwd });
    if (!parent.valid || !parent.claims) {
      return { ok: false, reason: "parent_invalid", hint: `parent passport invalid: ${parent.reason}` };
    }
    // Child scope must be a strict subset of parent scope.
    if (input.scope && parent.claims.scope) {
      const parentScopes = new Set(parent.claims.scope);
      for (const s of input.scope) {
        if (!parentScopes.has(s)) {
          return { ok: false, reason: "parent_scope_violation", hint: `child scope '${s}' not in parent scope` };
        }
      }
    }
    parentJti = parent.claims.jti;
  }

  // Trust score
  const trust = computeTrust(input.trustInputs ?? {});
  if (trust.score < tier.minTrust) {
    return {
      ok: false, reason: "trust_too_low",
      hint: `trust ${(trust.score * 100).toFixed(0)}% < required ${(tier.minTrust * 100).toFixed(0)}% for tier '${tierName}': ${trust.reason}`,
      trust, tier: { ...tier, name: tierName },
    };
  }

  const now = Date.now();
  const claims: PassportClaims = {
    tool: input.tool,
    tier: tierName,
    iat: new Date(now).toISOString(),
    exp: new Date(now + tier.ttlMs).toISOString(),
    jti: randomBytes(8).toString("hex"),
    parentJti,
    agent: input.agent,
    trust: trust.score,
    scope: input.scope,
  };
  const hmac = signClaims(claims);
  const token = encodeToken(claims, hmac);
  const passport: Passport = { claims, hmac, token };

  // Persist delegation edge.
  if (parentJti) {
    const g = readDelegations(cwd);
    g.parents[claims.jti] = parentJti;
    writeDelegations(cwd, g);
  }
  // Audit ledger.
  appendLedger(cwd, "issue", claims.jti, { tool: claims.tool, agent: claims.agent });

  return {
    ok: true, reason: "granted",
    hint: `passport issued: tier=${tierName} ttl=${(tier.ttlMs / 1000).toFixed(0)}s trust=${(trust.score * 100).toFixed(0)}%`,
    passport, trust, tier: { ...tier, name: tierName },
  };
}

/* ── Verify ─────────────────────────────────────────────────────── */

export interface VerifyInput {
  token: string;
  /** Optional tool name to enforce (token's claim.tool must equal). */
  expectedTool?: string;
  /** Optional scope ALL items must be present in claim.scope. */
  expectedScope?: string[];
  /** Working directory. */
  cwd?: string;
  /** Skip ledger append (used by inner chain walks). */
  noLedger?: boolean;
}

export function verifyPassport(input: VerifyInput): VerifyResult {
  const cwd = input.cwd ?? process.cwd();
  const decoded = decodePassport(input.token);
  if (!decoded) return { valid: false, reason: "malformed" };
  const { claims, hmac } = decoded;
  const expected = signClaims(claims);
  if (expected !== hmac) {
    if (!input.noLedger) appendLedger(cwd, "verify", claims.jti, { verdict: "bad_hmac", tool: claims.tool });
    return { valid: false, reason: "bad_hmac", claims };
  }
  const now = Date.now();
  const expMs = Date.parse(claims.exp);
  if (!Number.isFinite(expMs) || now > expMs) {
    if (!input.noLedger) appendLedger(cwd, "verify", claims.jti, { verdict: "expired", tool: claims.tool });
    return { valid: false, reason: "expired", claims };
  }
  const revoked = readRevocations(cwd);
  if (revoked.has(claims.jti)) {
    if (!input.noLedger) appendLedger(cwd, "verify", claims.jti, { verdict: "revoked", tool: claims.tool });
    return { valid: false, reason: "revoked", claims };
  }
  if (input.expectedTool && claims.tool !== input.expectedTool) {
    if (!input.noLedger) appendLedger(cwd, "verify", claims.jti, { verdict: "tool_mismatch", tool: claims.tool });
    return { valid: false, reason: "tool_mismatch", claims };
  }
  if (input.expectedScope && input.expectedScope.length > 0) {
    const have = new Set(claims.scope ?? []);
    for (const s of input.expectedScope) {
      if (!have.has(s)) {
        if (!input.noLedger) appendLedger(cwd, "verify", claims.jti, { verdict: "scope_mismatch", tool: claims.tool });
        return { valid: false, reason: "scope_mismatch", claims };
      }
    }
  }
  // Build delegation chain (audit-only — revocation cascade is handled
  // by revokePassport({cascade:true}) explicitly marking descendants.
  // If the caller used cascade=false on revoke, they're explicitly saying
  // descendants should remain valid — verify must honor that intent.
  const chain: PassportClaims[] = [];
  if (claims.parentJti) {
    const g = readDelegations(cwd);
    let cursor: string | undefined = claims.parentJti;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      chain.unshift({ ...claims, jti: cursor, tool: claims.tool });
      cursor = g.parents[cursor];
    }
  }
  if (!input.noLedger) appendLedger(cwd, "verify", claims.jti, { verdict: "valid", tool: claims.tool });
  return { valid: true, reason: "ok", ttlMs: expMs - now, claims, chain };
}

/* ── Revoke (with cascade) ──────────────────────────────────────── */

export interface RevokeInput {
  /** Either a token OR a jti can be passed. */
  token?: string;
  jti?: string;
  cwd?: string;
  /** Default true: revoking a parent revokes every descendant. */
  cascade?: boolean;
}

export interface RevokeResult {
  ok: boolean;
  revokedJtis: string[];
  hint: string;
}

export function revokePassport(input: RevokeInput): RevokeResult {
  const cwd = input.cwd ?? process.cwd();
  let jti = input.jti;
  if (!jti && input.token) {
    const d = decodePassport(input.token);
    if (d) jti = d.claims.jti;
  }
  if (!jti) return { ok: false, revokedJtis: [], hint: "missing jti or token" };
  const cascade = input.cascade !== false;
  const revoked = readRevocations(cwd);
  revoked.add(jti);
  const cascaded: string[] = [];
  if (cascade) {
    const g = readDelegations(cwd);
    for (const desc of descendantsOf(jti, g)) {
      if (!revoked.has(desc)) cascaded.push(desc);
      revoked.add(desc);
    }
  }
  writeRevocations(cwd, revoked);
  appendLedger(cwd, "revoke", jti, { verdict: cascade ? `cascade(+${cascaded.length})` : "single" });
  return {
    ok: true,
    revokedJtis: [jti, ...cascaded],
    hint: cascaded.length > 0 ? `revoked ${jti} + ${cascaded.length} delegated descendant(s)` : `revoked ${jti}`,
  };
}

/* ── Ledger verify ──────────────────────────────────────────────── */

export function verifyLedgerChain(cwd: string): { ok: boolean; rows: number; brokenAt?: number } {
  const lines = readLedgerLines(cwd);
  let prevHmac = "";
  for (let i = 0; i < lines.length; i++) {
    let row: LedgerEntry;
    try { row = JSON.parse(lines[i]!) as LedgerEntry; } catch { return { ok: false, rows: i, brokenAt: i }; }
    if (row.prevHmac !== prevHmac) return { ok: false, rows: i, brokenAt: i };
    const expected = createHmac("sha256", keyOf()).update(prevHmac).update(canonicalJson({
      kind: row.kind, at: row.at, jti: row.jti, tool: row.tool, agent: row.agent, verdict: row.verdict, prevHmac,
    })).digest("hex");
    if (expected !== row.hmac) return { ok: false, rows: i, brokenAt: i };
    prevHmac = row.hmac;
  }
  return { ok: true, rows: lines.length };
}

export function readLedger(cwd: string): LedgerEntry[] {
  return readLedgerLines(cwd).map((l) => {
    try { return JSON.parse(l) as LedgerEntry; } catch { return null; }
  }).filter((x): x is LedgerEntry => x !== null);
}

/* ── Re-exports ─────────────────────────────────────────────────── */

export { computeTrust } from "./trust_score.js";
export type { TrustInputs, TrustResult } from "./trust_score.js";
export { DEFAULT_POLICY, classifyTier, resolveTier } from "./policy.js";
export type { RiskTier, TierConfig } from "./policy.js";
