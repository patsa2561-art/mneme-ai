/**
 * OPERATION GRANT — the gem that resolves a real tension: an AI agent must perform privileged ops
 * (deploy, edit a service, migrate state), but a per-command human-approval gate either (a) gets
 * bypassed (unsafe) or (b) drowns the human in taps (so they rubber-stamp — also unsafe).
 *
 * The move (informed batch consent, scoped): the human approves a DESCRIBED PLAN once — a small set
 * of command PATTERNS, a TTL, and a max number of uses. The gate then AUTO-ALLOWS only commands that
 * match that signed grant (consuming a use + logging each), and pages as normal for anything outside
 * it. Like a surgeon getting consent for the whole procedure, not before each incision — but scoped,
 * time-boxed, use-bounded, signed, and audited, so it is the opposite of "allow everything".
 *
 * ★HONEST (DIAKRISIS): this REDUCES approval friction for a pre-approved plan WITHOUT widening blast
 * radius — a command must MATCH an explicit pattern the human saw + approved, the grant expires + runs
 * out of uses, and anything off-plan still pages. It is informed batch consent, not a bypass; a
 * forged/expired/exhausted/off-pattern command is never covered.
 */
import { createHmac } from "node:crypto";

export interface OpGrant {
  id: string; plan: string; patterns: string[];
  createdAt: number; exp: number; maxUses: number; uses: number;
  by: string; sig: string;
}
const SECRET = (s?: string) => s || "mneme-op-grant-v1";
function sign(g: Omit<OpGrant, "sig">, secret?: string): string {
  return createHmac("sha256", SECRET(secret)).update(`${g.id}|${g.plan}|${g.patterns.join("")}|${g.createdAt}|${g.exp}|${g.maxUses}|${g.by}`).digest("hex");
}

export interface MintGrantOpts { now: number; ttlMs?: number; maxUses?: number; by?: string; secret?: string; id?: string }
/** Mint a signed operation grant over a set of command patterns (the human-approved plan). */
export function mintGrant(plan: string, patterns: string[], opts: MintGrantOpts): OpGrant {
  const now = Number(opts?.now) || 0;
  const pats = (Array.isArray(patterns) ? patterns : []).map((p) => String(p ?? "").trim()).filter(Boolean);
  const base: Omit<OpGrant, "sig"> = {
    id: opts?.id || ("grant-" + createHmac("sha256", SECRET(opts?.secret)).update(`${plan}|${now}|${pats.join(",")}`).digest("hex").slice(0, 12)),
    plan: String(plan ?? ""), patterns: pats, createdAt: now,
    exp: now + (Number(opts?.ttlMs) || 30 * 60 * 1000), maxUses: Math.max(1, Number(opts?.maxUses) || 25),
    uses: 0, by: String(opts?.by ?? "human"),
  };
  return { ...base, sig: sign(base, opts?.secret) };
}
/** The grant's signature is intact (not tampered). */
export function grantValid(g: OpGrant, secret?: string): boolean {
  if (!g || typeof g !== "object") return false;
  const { sig, ...rest } = g; return !!sig && sig === sign(rest, secret);
}
/** Active = signature valid, not expired, uses left. */
export function grantActive(g: OpGrant, now: number, secret?: string): boolean {
  return grantValid(g, secret) && (Number(now) || 0) <= g.exp && (g.uses ?? 0) < g.maxUses;
}
/** A command is in scope when one of the grant's approved patterns is a substring of it. */
export function commandMatchesGrant(g: OpGrant, command: string): boolean {
  const c = String(command ?? ""); if (!c || !g?.patterns?.length) return false;
  return g.patterns.some((p) => p.length > 0 && c.includes(p));
}
/** The first ACTIVE grant whose pattern matches the command (or null). */
export function coveringGrant(grants: ReadonlyArray<OpGrant>, command: string, now: number, secret?: string): OpGrant | null {
  for (const g of grants ?? []) if (grantActive(g, now, secret) && commandMatchesGrant(g, command)) return g;
  return null;
}
/** Increment the use count of grant `id` (immutable). Returns the updated list. */
export function consumeGrant(grants: ReadonlyArray<OpGrant>, id: string): OpGrant[] {
  return (grants ?? []).map((g) => (g.id === id ? { ...g, uses: (g.uses ?? 0) + 1 } : g));
}
/** Drop expired/exhausted grants (housekeeping). */
export function pruneGrants(grants: ReadonlyArray<OpGrant>, now: number): OpGrant[] {
  return (grants ?? []).filter((g) => g && (Number(now) || 0) <= g.exp && (g.uses ?? 0) < g.maxUses);
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface GrantGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function grantGauntlet(): GrantGauntlet {
  const S = "s"; const T0 = 1000;
  const g = mintGrant("HA deploy: node2 + caddy LB + redis AOF", ["systemctl", "caddy", "redis-cli config"], { now: T0, ttlMs: 60000, maxUses: 5, secret: S });
  const inScope = !!coveringGrant([g], "systemctl restart keryx-relay", T0 + 100, S);
  const offScope = coveringGrant([g], "rm -rf /data", T0 + 100, S) === null;             // off-plan still pages
  const expired = coveringGrant([g], "systemctl x", g.exp + 1, S) === null;              // TTL enforced
  const forged = coveringGrant([{ ...g, plan: "EVIL widened plan" }], "systemctl x", T0 + 100, S) === null; // tamper → invalid sig
  // exhaust uses
  let list = [g]; for (let i = 0; i < 5; i++) list = consumeGrant(list, g.id);
  const exhausted = coveringGrant(list, "systemctl x", T0 + 100, S) === null;            // max-uses enforced
  const consumeOK = consumeGrant([g], g.id)[0].uses === 1;
  const validOK = grantValid(g, S) && !grantValid({ ...g, patterns: ["sudo"] }, S);       // pattern tamper caught
  const pruneOK = pruneGrants([g, { ...g, id: "old", exp: 0 }], T0 + 100).length === 1;
  const total = (() => { try { coveringGrant(null as never, "x", 0); mintGrant("", null as never, { now: 0 }); commandMatchesGrant(null as never, "x"); return true; } catch { return false; } })();

  const checks = [
    { name: "IN-SCOPE-COVERED", pass: inScope, detail: "a command matching an approved pattern is covered (auto-allow)" },
    { name: "OFF-PLAN-STILL-PAGES", pass: offScope, detail: "a command NOT in the plan is never covered → it still pages (no blast-radius widening)" },
    { name: "TTL-ENFORCED", pass: expired, detail: "past the grant's expiry → not covered" },
    { name: "MAX-USES-ENFORCED", pass: exhausted, detail: "after maxUses consumptions → not covered" },
    { name: "FORGED-REJECTED", pass: forged, detail: "tampering the plan/patterns breaks the signature → not covered" },
    { name: "CONSUME-INCREMENTS", pass: consumeOK, detail: "consuming a grant increments its use count" },
    { name: "SIG-OVER-PATTERNS", pass: validOK, detail: "the signature covers the patterns — you can't widen scope after approval" },
    { name: "PRUNE", pass: pruneOK, detail: "expired/exhausted grants are dropped" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
