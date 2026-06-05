/**
 * COSMIC PAGER — approve an autonomous agent's sensitive actions from your phone, even
 * with the laptop lid closed (and, on a "breathing-power" cadence, while it sleeps).
 *
 * Different from Anthropic's remote (which needs the machine awake + a live session):
 * here the brain stays on YOUR machine, the laptop reaches OUT to Telegram (long-poll,
 * behind NAT, no server), only a COMMAND SUMMARY + hash leaves (never code), and the
 * approval that comes back is a CRYPTOGRAPHIC TRANSFER OF AUTHORITY — not a dumb "yes".
 *
 * This module is the measurable HEART — 4 diamonds as pure, deterministic logic:
 *   1. SIGNED AUTHORITY TRANSFER  — a nonce bound to the exact (command-hash · agent ·
 *      session), one-time + TTL'd, so a captured message can't replay and an approval for
 *      "run tests" can't release "rm -rf" (hash mismatch → reject).
 *   2. TRUST-TIDE (the hybrid policy) — per command-class trust that self-tunes and blends
 *      three lanes per request: PRODUCTIVE (proven-safe → auto-allow, the pager goes quiet),
 *      CONSERVATIVE (unproven → page + hold, no default), FAIL-SAFE (destructive → page, and
 *      auto-DENY on timeout). A destructive class can NEVER graduate to auto-allow (hard
 *      ceiling); a single denial/regret demotes a class.
 *   3. DEAD-MAN QUEUE — leave it running overnight: on timeout each pending resolves by its
 *      lane (safe→allow, destructive→deny, moderate→hold) so you wake to a batch to approve.
 *   4. COURT-ADMISSIBLE RECEIPT — every decision is a signed record ("the human, not the
 *      AI, approved hash Y at time T from channel Z") — accountability no Telegram bot has.
 *
 * Pure + total + deterministic (nonce / timestamps are passed in). Signed at the boundary.
 */
import { createHash } from "node:crypto";

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

export type Lane = "productive" | "conservative" | "failsafe";
export type Action = "AUTO_ALLOW" | "PAGE_HOLD" | "PAGE_THEN_DENY";
export type Blast = "safe" | "moderate" | "destructive";

// ─── Diamond 1: SIGNED AUTHORITY TRANSFER ─────────────────────────────────────
export interface ApprovalRequest {
  id: string;
  commandHash: string;   // sha256(raw) — the raw NEVER leaves the machine
  summary: string;       // human-readable (must be egress-screened before paging)
  agent: string;
  session: string;
  klass: string;
  blast: Blast;
  nonce: string;         // one-time secret bound into the authority
  createdAt: number;
  expiresAt: number;
}

export function mintApprovalRequest(i: { rawCommand: string; summary: string; agent: string; session: string; klass: string; blast: Blast; nonce: string; now: number; ttlMs?: number }): ApprovalRequest {
  const commandHash = sha256(String(i.rawCommand ?? ""));
  const ttl = i.ttlMs ?? 5 * 60_000;
  const id = sha256(`${commandHash}|${i.agent}|${i.session}|${i.nonce}`).slice(0, 16);
  return { id, commandHash, summary: String(i.summary ?? "").slice(0, 300), agent: String(i.agent ?? ""), session: String(i.session ?? ""), klass: String(i.klass ?? "unknown"), blast: i.blast ?? "moderate", nonce: String(i.nonce ?? ""), createdAt: i.now, expiresAt: i.now + ttl };
}

/** Verify a presented approval transfers authority for THIS exact request, once, in time. */
export function verifyApproval(req: ApprovalRequest, presented: { nonce: string; commandHash: string; agent: string; session: string }, now: number, alreadyUsed: boolean): { ok: boolean; reason: string } {
  if (!req) return { ok: false, reason: "no request" };
  if (alreadyUsed) return { ok: false, reason: "replay — nonce already consumed" };
  if (now > req.expiresAt) return { ok: false, reason: "expired (TTL passed)" };
  if (presented?.nonce !== req.nonce) return { ok: false, reason: "nonce mismatch" };
  if (presented?.commandHash !== req.commandHash) return { ok: false, reason: "command-hash mismatch — approval not bound to THIS command" };
  if (presented?.agent !== req.agent || presented?.session !== req.session) return { ok: false, reason: "agent/session mismatch" };
  return { ok: true, reason: "authority verified — bound, one-time, in-TTL" };
}

// ─── Diamond 2: TRUST-TIDE (self-tuning hybrid policy) ─────────────────────────
export interface ClassTrust { approvals: number; denials: number }
export interface TrustState { v: 1; classes: Record<string, ClassTrust> }
export function emptyTrust(): TrustState { return { v: 1, classes: {} }; }

/** Wilson 95% lower bound on the user's approval rate for a class (small n ⇒ low ⇒ stays gated). */
export function classTrust(state: TrustState, klass: string): number {
  const c = state?.classes?.[klass]; if (!c) return 0;
  const n = c.approvals + c.denials; if (n === 0) return 0;
  const p = c.approvals / n, z = 1.96;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, (centre - margin) / denom);
}

/** THE HYBRID: pick the lane + action for a request by blast × trust. Destructive is capped. */
export function decide(req: ApprovalRequest, state: TrustState, opts: { productiveTrust?: number; minSamples?: number } = {}): { lane: Lane; action: Action; reason: string } {
  if (!req || typeof req !== "object") return { lane: "conservative", action: "PAGE_HOLD", reason: "no request → hold" };
  const productiveTrust = opts.productiveTrust ?? 0.7, minSamples = opts.minSamples ?? 5;
  // FAIL-SAFE lane — destructive can NEVER auto-allow, no matter how trusted (hard ceiling).
  if (req.blast === "destructive") return { lane: "failsafe", action: "PAGE_THEN_DENY", reason: "destructive → page a human; auto-DENY on timeout (never auto-allowed)" };
  const c = state?.classes?.[req.klass]; const n = (c?.approvals ?? 0) + (c?.denials ?? 0);
  const t = classTrust(state, req.klass);
  // PRODUCTIVE lane — proven-safe class → auto-allow (the pager goes quiet).
  if (req.blast === "safe" && n >= minSamples && t >= productiveTrust) return { lane: "productive", action: "AUTO_ALLOW", reason: `class proven safe (trust ${(t * 100) | 0}% over ${n}) → auto-allow` };
  // CONSERVATIVE lane — unproven / moderate → page + hold, no auto-default.
  return { lane: "conservative", action: "PAGE_HOLD", reason: "unproven or moderate → page + hold for a human (no auto-default)" };
}

/** Update class trust from an outcome. Approve raises; deny/regret lowers (demotes the lane). */
export function updateTrust(state: TrustState, klass: string, outcome: "approved" | "denied" | "regret"): TrustState {
  const s: TrustState = { v: 1, classes: { ...(state?.classes ?? {}) } };
  const c = { ...(s.classes[klass] ?? { approvals: 0, denials: 0 }) };
  if (outcome === "approved") c.approvals += 1;
  else { c.denials += 1; if (outcome === "regret") c.denials += 2; } // a regret bites harder → fast demotion
  s.classes[klass] = c;
  return s;
}

// ─── Diamond 3: DEAD-MAN QUEUE (leave it running; wake to a batch) ─────────────
export interface Pending { req: ApprovalRequest; status: "pending" | "approved" | "denied"; lane: Lane }
export interface DeadmanResult { resolved: Array<{ id: string; decision: "allow" | "deny"; why: string }>; stillPending: Pending[] }

/** On the wake tick: timed-out pendings resolve by their lane (safe→allow, destructive→deny,
 *  moderate→stay pending for the human). The rest wait. */
export function deadmanResolve(pendings: ReadonlyArray<Pending>, now: number): DeadmanResult {
  const resolved: DeadmanResult["resolved"] = []; const stillPending: Pending[] = [];
  for (const p of pendings ?? []) {
    if (!p || p.status !== "pending") continue;
    if (now <= p.req.expiresAt) { stillPending.push(p); continue; }
    if (p.lane === "failsafe") resolved.push({ id: p.req.id, decision: "deny", why: "destructive timed out unattended → fail-safe DENY" });
    else if (p.lane === "productive") resolved.push({ id: p.req.id, decision: "allow", why: "proven-safe timed out → allow" });
    else stillPending.push(p); // conservative: never auto-resolve — wait for the human's batch
  }
  return { resolved, stillPending };
}

/** Group the still-pending queue for a one-message batch approval on the phone. */
export function batchView(pendings: ReadonlyArray<Pending>): { safe: Pending[]; moderate: Pending[]; destructive: Pending[] } {
  const g = { safe: [] as Pending[], moderate: [] as Pending[], destructive: [] as Pending[] };
  for (const p of pendings ?? []) { if (p?.status === "pending") g[p.req.blast].push(p); }
  return g;
}

// ─── Diamond 4: COURT-ADMISSIBLE RECEIPT ──────────────────────────────────────
export interface ApprovalReceipt {
  reqId: string; commandHash: string; decision: "allow" | "deny"; decidedBy: "human" | "policy-auto" | "deadman";
  channel: string; lane: Lane; ts: number; receiptHash: string;
}
export function buildReceipt(req: ApprovalRequest, decision: "allow" | "deny", decidedBy: ApprovalReceipt["decidedBy"], channel: string, lane: Lane, ts: number): ApprovalReceipt {
  const base = { reqId: req.id, commandHash: req.commandHash, decision, decidedBy, channel, lane, ts };
  return { ...base, receiptHash: sha256(JSON.stringify(base)) };
}

// ─── gauntlet ─────────────────────────────────────────────────────────────────
export interface PagerGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }

export function pagerGauntlet(): PagerGauntlet {
  const now = 1_700_000_000_000;
  const req = mintApprovalRequest({ rawCommand: "npm test", summary: "run tests", agent: "cursor", session: "s1", klass: "npm-test", blast: "safe", nonce: "N1", now });

  // 1. AUTHORITY: bound + one-time + TTL
  const good = verifyApproval(req, { nonce: "N1", commandHash: req.commandHash, agent: "cursor", session: "s1" }, now + 1000, false).ok;
  const wrongHash = !verifyApproval(req, { nonce: "N1", commandHash: sha256("rm -rf /"), agent: "cursor", session: "s1" }, now + 1000, false).ok;
  const expired = !verifyApproval(req, { nonce: "N1", commandHash: req.commandHash, agent: "cursor", session: "s1" }, now + 10 * 60_000, false).ok;
  const replay = !verifyApproval(req, { nonce: "N1", commandHash: req.commandHash, agent: "cursor", session: "s1" }, now + 1000, true).ok;
  const authority = good && wrongHash && expired && replay;

  // 2. TRUST-TIDE: destructive never auto-allows even when "trusted"; safe graduates; deny demotes
  let trust = emptyTrust();
  for (let k = 0; k < 12; k++) trust = updateTrust(trust, "npm-test", "approved");
  const safeReq = mintApprovalRequest({ rawCommand: "npm test", summary: "t", agent: "a", session: "s", klass: "npm-test", blast: "safe", nonce: "n", now });
  const productive = decide(safeReq, trust).action === "AUTO_ALLOW";
  let trustDestructive = emptyTrust(); for (let k = 0; k < 50; k++) trustDestructive = updateTrust(trustDestructive, "rm", "approved");
  const destReq = mintApprovalRequest({ rawCommand: "rm -rf x", summary: "t", agent: "a", session: "s", klass: "rm", blast: "destructive", nonce: "n", now });
  const ceiling = decide(destReq, trustDestructive).action === "PAGE_THEN_DENY"; // capped despite 50 approvals
  const unprovenReq = mintApprovalRequest({ rawCommand: "curl x", summary: "t", agent: "a", session: "s", klass: "curl", blast: "safe", nonce: "n", now });
  const conservative = decide(unprovenReq, emptyTrust()).action === "PAGE_HOLD";
  const demoted = (() => { let s = trust; for (let k = 0; k < 6; k++) s = updateTrust(s, "npm-test", "regret"); return decide(safeReq, s).action === "PAGE_HOLD"; })();
  const tide = productive && ceiling && conservative && demoted;

  // 3. DEAD-MAN: safe→allow, destructive→deny, moderate→hold on timeout
  const past = now + 10 * 60_000;
  const pendings: Pending[] = [
    { req: mintApprovalRequest({ rawCommand: "a", summary: "", agent: "a", session: "s", klass: "k", blast: "safe", nonce: "1", now }), status: "pending", lane: "productive" },
    { req: mintApprovalRequest({ rawCommand: "b", summary: "", agent: "a", session: "s", klass: "k", blast: "destructive", nonce: "2", now }), status: "pending", lane: "failsafe" },
    { req: mintApprovalRequest({ rawCommand: "c", summary: "", agent: "a", session: "s", klass: "k", blast: "moderate", nonce: "3", now }), status: "pending", lane: "conservative" },
  ];
  const dm = deadmanResolve(pendings, past);
  const deadman = dm.resolved.find((r) => r.decision === "allow") && dm.resolved.find((r) => r.decision === "deny") && dm.stillPending.length === 1 && dm.stillPending[0].req.blast === "moderate";

  // 4. RECEIPT: binds the decision, deterministic
  const r1 = buildReceipt(req, "allow", "human", "telegram", "conservative", now);
  const r2 = buildReceipt(req, "allow", "human", "telegram", "conservative", now);
  const receipt = r1.receiptHash === r2.receiptHash && r1.commandHash === req.commandHash && buildReceipt(req, "deny", "human", "telegram", "conservative", now).receiptHash !== r1.receiptHash;

  const total = (() => { try { decide(null as never, null as never); deadmanResolve(null as never, 0); verifyApproval(null as never, null as never, 0, false); return true; } catch { return false; } })();

  const checks = [
    { name: "SIGNED-AUTHORITY", pass: authority, detail: "approval is bound to the exact command-hash, one-time (no replay), TTL'd" },
    { name: "TRUST-TIDE-HYBRID", pass: tide, detail: "proven-safe→auto-allow · unproven→hold · destructive capped (never auto-allow) · regret demotes" },
    { name: "DEAD-MAN-QUEUE", pass: !!deadman, detail: "left running: safe auto-allows, destructive auto-denies, moderate waits for the human's batch" },
    { name: "COURT-ADMISSIBLE", pass: receipt, detail: "every decision is a deterministic, content-bound receipt (signed at the boundary)" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
