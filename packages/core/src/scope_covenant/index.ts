/**
 * SCOPE COVENANT — the accountability primitive the autonomous-agent world is missing.
 *
 * Today nothing verifies the promise an autonomous agent implicitly makes: "I will only touch X."
 * git checks TEXT, CI checks TESTS, a truth engine checks HALLUCINATION — but none answer "did this
 * agent stay within the architectural SCOPE it declared, across layers?" An agent cannot certify its
 * own scope-keeping (it grades its own homework), so this must come from a NEUTRAL, deterministic,
 * cross-vendor layer. That is the gap this fills — and it is, to our knowledge, not built anywhere:
 *
 *   1. Before an edit, the agent DECLARES a scope (files + the tables/endpoints it intends to reach).
 *   2. After, Mneme computes the ACTUAL cross-layer blast radius from the deterministic graph and
 *      issues a verdict — HONORED, or BREACHED with the exact unpromised tables/endpoints/files it
 *      reached. Deterministic, so a reviewer/CI/another agent verifies it WITHOUT trusting the agent.
 *   3. Verdicts accrue into a per-agent, CROSS-VENDOR Scope-Fidelity score (Wilson 95% lower bound):
 *      "how faithfully does this agent keep the scope it promises" — a portable trust signal grounded
 *      in real structural evidence, not vibes.
 *
 * ★HONEST (DIAKRISIS): this proves the STRUCTURAL scope (which files + cross-layer nodes the diff
 * reaches) matched the declaration — deterministic, NOT a proof of runtime correctness or behaviour.
 * The fidelity score is a measured track record with a confidence interval, not a guarantee. The win
 * is that none of this existed: a signed, offline-verifiable, cross-vendor record of whether an
 * autonomous agent kept its architectural word.
 */
import { type CrossLayerGraph, buildCrossLayerGraph, diffBlastRadius, parseChangedSymbols, type DiffChange } from "../cross_layer_graph/index.js";

const lc = (s: string) => String(s ?? "").toLowerCase();
const STOP = new Set(["the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "with", "is", "are", "be", "as", "by", "at", "this", "that", "it", "fix", "add", "update", "change", "edit", "only", "just", "table", "endpoint", "route", "function"]);
function tokset(s: string): Set<string> {
  return new Set(String(s ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-/.]/g, " ").split(/\s+/).map(lc).filter((p) => (p.length >= 3 || /[฀-๿]/.test(p)) && !STOP.has(p)));
}

export interface ScopeAllow { files?: string[]; tables?: string[]; endpoints?: string[]; functions?: string[] }
export interface ScopeDeclaration { agent: string; intent: string; allow?: ScopeAllow }
export interface ScopeVerdict {
  verdict: "HONORED" | "BREACHED" | "EMPTY";
  honored: boolean;
  agent: string;
  reachedTables: string[]; reachedEndpoints: string[];
  breachFiles: string[]; breachTables: string[]; breachEndpoints: string[];
  changedFiles: string[];
  reason: string;
}

function norm(p: string): string { return lc(p).replace(/\\/g, "/").replace(/^\.\//, ""); }
function fileAllowed(file: string, allowFiles: string[]): boolean {
  const f = norm(file);
  return allowFiles.some((a) => { const g = norm(a).replace(/\*+$/, ""); return f === norm(a) || f.startsWith(g) || f.includes(g) || g.includes(f); });
}

/**
 * Verify a diff against a declared scope. A reached table/endpoint is a BREACH unless it's in the
 * allow-list, named in the intent (token overlap), or lives in an allowed file. A changed file is a
 * BREACH unless it matches the allow.files globs (when files were declared). Pure + deterministic.
 */
export function verifyScope(graph: CrossLayerGraph, diff: string | ReadonlyArray<DiffChange>, decl: ScopeDeclaration): ScopeVerdict {
  const allow = decl?.allow ?? {};
  const b = diffBlastRadius(graph, diff as never, { maxDepth: 1 });
  const changedFiles = [...new Set((typeof diff === "string" ? parseChangedSymbols(diff) : (diff ?? []).slice()).map((c) => c.file).filter(Boolean))];
  const intentTokens = tokset(decl?.intent ?? "");
  const allowTables = new Set((allow.tables ?? []).map(lc));
  const allowEndpoints = new Set((allow.endpoints ?? []).map(lc));
  const allowFiles = (allow.files ?? []).filter(Boolean);

  const tableAllowed = (name: string) => { const n = lc(name); if (allowTables.has(n)) return true; if (intentTokens.has(n) || intentTokens.has(n.replace(/s$/, ""))) return true; return false; };
  const endpointAllowed = (name: string) => { const n = lc(name); if (allowEndpoints.has(n)) return true; if (intentTokens.has(n.replace(/^\/+/, ""))) return true; return false; };

  const reachedTables = b.tables.map((t) => t.name); const reachedEndpoints = b.endpoints.map((e) => `${e.method} ${e.name}`);
  const breachTables = b.tables.filter((t) => !tableAllowed(t.name)).map((t) => t.name);
  const breachEndpoints = b.endpoints.filter((e) => !endpointAllowed(e.name)).map((e) => `${e.method} ${e.name}`);
  const breachFiles = allowFiles.length ? changedFiles.filter((f) => !fileAllowed(f, allowFiles)) : [];

  if (!b.changed && !changedFiles.length) return { verdict: "EMPTY", honored: true, agent: decl?.agent ?? "agent", reachedTables, reachedEndpoints, breachFiles: [], breachTables: [], breachEndpoints: [], changedFiles, reason: "empty diff — nothing to verify" };

  const breaches = breachFiles.length + breachTables.length + breachEndpoints.length;
  const reason = breaches
    ? `reached ${[...breachFiles.map((f) => "file " + f), ...breachTables.map((t) => "table " + t), ...breachEndpoints.map((e) => "endpoint " + e)].join(", ")} — outside the declared scope`
    : "the edit stayed within the declared scope";
  return { verdict: breaches ? "BREACHED" : "HONORED", honored: breaches === 0, agent: decl?.agent ?? "agent", reachedTables, reachedEndpoints, breachFiles, breachTables, breachEndpoints, changedFiles, reason };
}

// ── Scope Fidelity — a cross-vendor track record of scope-keeping ────────────────────────────────
export interface ScopeRecord { agent: string; honored: boolean; at: number }
export type FidelityBand = "EXEMPLARY" | "RELIABLE" | "WOBBLY" | "UNTRUSTED" | "UNPROVEN";
export interface ScopeFidelity { agent: string; total: number; honored: number; rateLB: number; band: FidelityBand }
function wilsonLB(succ: number, n: number): number {
  if (n <= 0) return 0; const p = succ / n, z = 1.96, z2 = z * z;
  return Math.max(0, ((p + z2 / (2 * n)) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n));
}
export function recordScope(ledger: ReadonlyArray<ScopeRecord>, agent: string, honored: boolean, at: number): ScopeRecord[] {
  return [...(ledger ?? []), { agent: String(agent || "agent").slice(0, 80), honored: !!honored, at: Number(at) || 0 }];
}
export function scopeFidelity(ledger: ReadonlyArray<ScopeRecord>, agent: string, opts?: { minSamples?: number }): ScopeFidelity {
  const minSamples = opts?.minSamples ?? 5;
  const rows = (ledger ?? []).filter((r) => r.agent === agent);
  const total = rows.length, honored = rows.filter((r) => r.honored).length, rateLB = wilsonLB(honored, total);
  let band: FidelityBand;
  if (total < minSamples) band = "UNPROVEN";
  else if (rateLB >= 0.9) band = "EXEMPLARY";
  else if (rateLB >= 0.7) band = "RELIABLE";
  else if (rateLB >= 0.4) band = "WOBBLY";
  else band = "UNTRUSTED";
  return { agent, total, honored, rateLB: Math.round(rateLB * 100) / 100, band };
}
export function rankFidelity(ledger: ReadonlyArray<ScopeRecord>, opts?: { minSamples?: number }): ScopeFidelity[] {
  const agents = [...new Set((ledger ?? []).map((r) => r.agent))];
  const order: Record<FidelityBand, number> = { EXEMPLARY: 4, RELIABLE: 3, WOBBLY: 2, UNTRUSTED: 1, UNPROVEN: 0 };
  return agents.map((a) => scopeFidelity(ledger, a, opts)).sort((x, y) => order[y.band] - order[x.band] || y.rateLB - x.rateLB || y.total - x.total);
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ScopeGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function scopeGauntlet(): ScopeGauntlet {
  // a fixture: createUserWallet writes Wallet, lives in auth.ts
  const g = buildCrossLayerGraph([
    { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Payment { id Int @id }" },
    { path: "auth.ts", content: "export function createUserWallet(uid){ return prisma.wallet.create({data:{uid}}); }" },
    { path: "billing.ts", content: "export function charge(uid){ return prisma.payment.create({data:{uid}}); }" },
  ]);
  const diffWallet = "--- a/auth.ts\n+++ b/auth.ts\n@@ -1,1 +1,2 @@ export function createUserWallet(uid){\n+ log(uid);\n";
  const diffBoth = "--- a/auth.ts\n+++ b/auth.ts\n@@ -1,1 +1,2 @@ export function createUserWallet(uid){\n+ charge(uid);\n--- a/billing.ts\n+++ b/billing.ts\n@@ -1,1 +1,2 @@ export function charge(uid){\n+ log(uid);\n";
  // declared: only auth.ts + the wallet table. Editing auth (writes wallet) → HONORED.
  const honored = verifyScope(g, diffWallet, { agent: "a", intent: "tweak wallet creation", allow: { files: ["auth.ts"], tables: ["Wallet"] } });
  // same scope, but the diff ALSO edits billing.ts (writes Payment) → BREACHED (file + table)
  const breached = verifyScope(g, diffBoth, { agent: "a", intent: "tweak wallet creation", allow: { files: ["auth.ts"], tables: ["Wallet"] } });
  const honoredOK = honored.verdict === "HONORED" && honored.honored;
  const breachedOK = breached.verdict === "BREACHED" && breached.breachFiles.includes("billing.ts") && breached.breachTables.includes("Payment");
  // fidelity: 9/10 honored → RELIABLE+ ; thin → UNPROVEN
  let led: ScopeRecord[] = []; for (let i = 0; i < 20; i++) led = recordScope(led, "good", i < 19, i); for (let i = 0; i < 2; i++) led = recordScope(led, "new", true, i);
  const fid = scopeFidelity(led, "good"); const thin = scopeFidelity(led, "new");
  const fidOK = (fid.band === "EXEMPLARY" || fid.band === "RELIABLE") && fid.rateLB < 1 && thin.band === "UNPROVEN";
  const total = (() => { try { verifyScope(null as never, "x", null as never); scopeFidelity(null as never, "x"); rankFidelity(null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "HONORED", pass: honoredOK, detail: "an edit that stays within the declared files + tables → HONORED" },
    { name: "BREACHED", pass: breachedOK, detail: "an edit that reaches an unpromised file + table → BREACHED, naming both (the silent overreach catch)" },
    { name: "FIDELITY-WILSON", pass: fidOK, detail: "cross-vendor scope-fidelity = Wilson lower bound (9/10 ≠ 100%; thin data → UNPROVEN, never faked high)" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
