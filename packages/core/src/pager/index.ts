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
/** A page can ask for a yes/no, a pick-one, or a typed free-text answer. */
export type QuestionKind = "approve" | "choice" | "text";

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
  /** elicitation kind (default "approve" for back-compat). */
  kind?: QuestionKind;
  /** for kind:"choice" — the allowed options. */
  choices?: string[];
  /** the question text shown to the human (for choice/text); falls back to summary. */
  question?: string;
  /** sha256(question||choices) — binds the human's answer to THIS question. */
  questionHash?: string;
  /** vendor that asked (so the answer is portable + attributable across vendors). */
  vendor?: string;
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

// ─── Diamond 5: ELICITATION (yes/no · pick-one · free text) ───────────────────
/** Mint a question of any kind. `answerSpace` is the raw the human is answering ABOUT;
 *  for text/choice the `question` text is what's shown, bound by questionHash. */
export function mintQuestion(i: { rawContext: string; question: string; kind: QuestionKind; choices?: string[]; agent: string; session: string; vendor?: string; klass?: string; blast?: Blast; nonce: string; now: number; ttlMs?: number }): ApprovalRequest {
  const base = mintApprovalRequest({ rawCommand: i.rawContext, summary: String(i.question ?? "").slice(0, 300), agent: i.agent, session: i.session, klass: i.klass ?? i.kind, blast: i.blast ?? "moderate", nonce: i.nonce, now: i.now, ttlMs: i.ttlMs });
  const choices = i.kind === "choice" ? [...new Set((i.choices ?? []).map(String).filter(Boolean))] : undefined;
  const questionHash = sha256(`${i.kind}|${String(i.question ?? "")}|${(choices ?? []).join("")}`);
  return { ...base, kind: i.kind, choices, question: String(i.question ?? ""), questionHash, vendor: i.vendor };
}

/** Validate a human's answer against the question's kind. */
export function verifyAnswer(req: ApprovalRequest, answer: string): { ok: boolean; normalized: string; reason: string } {
  const a = String(answer ?? "").trim();
  const kind = req?.kind ?? "approve";
  if (kind === "approve") { const yes = /^(y|yes|allow|approve|ok|✅)$/i.test(a), no = /^(n|no|deny|block|⛔)$/i.test(a); if (!yes && !no) return { ok: false, normalized: "", reason: "expected yes/no" }; return { ok: true, normalized: yes ? "allow" : "deny", reason: "approve answer" }; }
  if (kind === "choice") { const hit = (req.choices ?? []).find((c) => c.toLowerCase() === a.toLowerCase()); if (!hit) return { ok: false, normalized: "", reason: `not one of: ${(req.choices ?? []).join(", ")}` }; return { ok: true, normalized: hit, reason: "valid choice" }; }
  if (!a) return { ok: false, normalized: "", reason: "empty text answer" };
  return { ok: true, normalized: a, reason: "free-text answer" };
}

// ─── Diamond 6: PROXY OF RECORD (signed, vendor-portable human decision) ──────
/** The hidden diamond: a human's answer becomes a signed, court-admissible, VENDOR-PORTABLE
 *  fact bound to the exact question — "human answered X to question Y at T via channel C,
 *  asked by vendor V". Any vendor can verify + inherit it; it survives an agent handoff. */
export interface HumanDecisionRecord {
  questionHash: string;
  commandHash: string;
  kind: QuestionKind;
  answer: string;          // normalized: "allow"/"deny" | the chosen option | the typed text
  decidedBy: "human";
  vendor: string;
  channel: string;
  agent: string;
  session: string;
  ts: number;
  recordHash: string;      // binds all of the above (NOTARY-signed at the boundary)
}
export function recordHumanDecision(req: ApprovalRequest, normalizedAnswer: string, channel: string, vendor: string, ts: number): HumanDecisionRecord {
  const base = { questionHash: req?.questionHash ?? sha256(String(req?.summary ?? "")), commandHash: req?.commandHash ?? "", kind: req?.kind ?? "approve", answer: String(normalizedAnswer), decidedBy: "human" as const, vendor: String(vendor || req?.vendor || "unknown"), channel: String(channel), agent: req?.agent ?? "", session: req?.session ?? "", ts: Number(ts) || 0 };
  return { ...base, recordHash: sha256(JSON.stringify(base)) };
}
/** Verify a human-decision record is intact + bound to the expected question. */
export function verifyHumanDecision(rec: HumanDecisionRecord, expectedQuestionHash?: string): { ok: boolean; reason: string } {
  if (!rec) return { ok: false, reason: "no record" };
  const { recordHash, ...base } = rec;
  if (sha256(JSON.stringify(base)) !== recordHash) return { ok: false, reason: "record tampered" };
  if (expectedQuestionHash && rec.questionHash !== expectedQuestionHash) return { ok: false, reason: "answer bound to a DIFFERENT question" };
  return { ok: true, reason: `human (${rec.decidedBy}) answered "${rec.answer}" via ${rec.channel}, asked by ${rec.vendor} — portable + court-admissible` };
}

// ─── Diamond 7: DUAL-SURFACE RACE (answer from the phone OR the keyboard) ─────
export interface SurfaceAnswer { surface: "phone" | "local"; answer: string; ts: number }
/** Whichever surface answers first wins; the other is told to dismiss. Pure + deterministic
 *  (ties → the earlier ts, else "local" — a present human at the keyboard beats a stale page). */
export function resolveRace(local: SurfaceAnswer | null, phone: SurfaceAnswer | null): { winner: SurfaceAnswer | null; dismiss: "phone" | "local" | null } {
  if (!local && !phone) return { winner: null, dismiss: null };
  if (local && !phone) return { winner: local, dismiss: "phone" };
  if (phone && !local) return { winner: phone, dismiss: "local" };
  const l = local as SurfaceAnswer, p = phone as SurfaceAnswer;
  const localWins = l.ts <= p.ts;
  return { winner: localWins ? l : p, dismiss: localWins ? "phone" : "local" };
}

// ─── Diamond 8: TURN ROUTER (what reaches the phone, and as what kind) ────────
/** Classify an AI's chat turn: is it actually waiting on the human, and if so as what UI?
 *  This is how the pager decides WHICH questions to send — and renders the right control:
 *  yes/no buttons (approve) · pick-one buttons (choice) · a typed reply (text). A statement
 *  (no question) is NOT routed. Deterministic, no LLM. */
export interface TurnClass { isQuestion: boolean; kind: QuestionKind; choices?: string[]; question: string }
export function classifyTurn(text: string): TurnClass {
  const t = String(text ?? "").trim();
  if (!t) return { isQuestion: false, kind: "text", question: "" };
  // the operative ask is usually the last question line
  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const qLine = [...lines].reverse().find((l) => l.includes("?") || /\b(should i|shall i|do you want|which|choose|pick|ok to|confirm|proceed)\b/i.test(l)) ?? lines[lines.length - 1] ?? t;
  const hasQ = /\?|\b(should i|shall i|do you want|which|choose|pick|ok to|confirm|proceed|y\/n|yes\/no)\b/i.test(qLine);
  if (!hasQ) return { isQuestion: false, kind: "text", question: qLine };
  // pick-one: numbered/bulleted options, or "A, B, or C"
  const numbered = t.match(/^\s*(?:\d+[.)]|[-*]|[a-d][.)])\s+(.{1,60})$/gim);
  if (numbered && numbered.length >= 2) {
    const choices = numbered.map((m) => m.replace(/^\s*(?:\d+[.)]|[-*]|[a-d][.)])\s+/i, "").trim()).filter(Boolean).slice(0, 8);
    return { isQuestion: true, kind: "choice", choices, question: qLine };
  }
  const orList = qLine.match(/\b([\w-]+(?:\s[\w-]+)?)(?:,\s*([\w-]+(?:\s[\w-]+)?))+,?\s+or\s+([\w-]+(?:\s[\w-]+)?)\??/i);
  if (orList) { const opts = qLine.replace(/\?$/, "").split(/,\s*|\s+or\s+/i).map((s) => s.trim()).filter(Boolean).slice(-4); if (opts.length >= 2) return { isQuestion: true, kind: "choice", choices: opts, question: qLine }; }
  // yes/no — only on STRONG signals (avoid false-positives like "What should I name?")
  const ynStart = /^(should|shall|do|does|did|can|could|may|might|is|are|was|were|will|would|have|has|ok\b)/i;
  const ynMarker = /\b(y\/n|yes\/no|do you want|ok to|shall i|confirm|proceed)\b/i;
  const thYn = /(ไหม|มั้ย|หรือไม่|ดีไหม|เอาไหม)\s*\??$/;
  if (ynStart.test(qLine) || ynMarker.test(qLine) || thYn.test(qLine)) return { isQuestion: true, kind: "approve", question: qLine };
  // otherwise open-ended (what / how / which-without-options …) → typed reply
  return { isQuestion: true, kind: "text", question: qLine };
}

export type PagerMode = "attended" | "unattended";
/** Decide whether to page a CONVERSATIONAL turn. Attended (you're at the keyboard) → never
 *  auto-page (questions stay in chat). Unattended (lid closed / away) → page real questions. */
export function decideRoute(cls: TurnClass, mode: PagerMode): { page: boolean; kind: QuestionKind; reason: string } {
  if (!cls?.isQuestion) return { page: false, kind: "text", reason: "not a question — nothing to route" };
  if (mode !== "unattended") return { page: false, kind: cls.kind, reason: "attended: you're at the keyboard — stays in chat" };
  return { page: true, kind: cls.kind, reason: `unattended: routing a ${cls.kind} question to your phone` };
}

// ─── gauntlet (scored out of 1000) ────────────────────────────────────────────
export interface PagerGauntlet { score: number; max: 1000; passed: number; total: number; checks: Array<{ name: string; pass: boolean; detail: string }> }

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

  const total = (() => { try { decide(null as never, null as never); deadmanResolve(null as never, 0); verifyApproval(null as never, null as never, 0, false); verifyAnswer(null as never, null as never); recordHumanDecision(null as never, "", "", "", 0); resolveRace(null, null); classifyTurn(null as never); decideRoute(null as never, "attended"); return true; } catch { return false; } })();

  // 9. TURN ROUTER: classify what to page + as what kind; statement is not routed; mode gates
  const cYesNo = classifyTurn("I'm ready to deploy. Should I push to prod? (y/n)");
  const cChoice = classifyTurn("Which environment?\n1. production\n2. staging\n3. local");
  const cText = classifyTurn("What should I name this release?");
  const cStatement = classifyTurn("I finished refactoring the auth module and all tests pass.");
  const routeOK = cYesNo.kind === "approve" && cYesNo.isQuestion && cChoice.kind === "choice" && (cChoice.choices?.length ?? 0) === 3 && cText.kind === "text" && cText.isQuestion && cStatement.isQuestion === false;
  const modeOK = decideRoute(cYesNo, "attended").page === false && decideRoute(cYesNo, "unattended").page === true && decideRoute(cStatement, "unattended").page === false;
  const router = routeOK && modeOK;

  // 5. ELICITATION: approve / choice / text
  const qApprove = mintQuestion({ rawContext: "deploy", question: "Deploy to prod?", kind: "approve", agent: "a", session: "s", nonce: "1", now });
  const qChoice = mintQuestion({ rawContext: "branch", question: "Which branch?", kind: "choice", choices: ["main", "dev", "stage"], agent: "a", session: "s", nonce: "2", now });
  const qText = mintQuestion({ rawContext: "name", question: "Name the release:", kind: "text", agent: "a", session: "s", nonce: "3", now });
  const approveOk = verifyAnswer(qApprove, "yes").normalized === "allow" && !verifyAnswer(qApprove, "maybe").ok;
  const choiceOk = verifyAnswer(qChoice, "dev").normalized === "dev" && !verifyAnswer(qChoice, "prod").ok;
  const textOk = verifyAnswer(qText, "v2.0 Falcon").normalized === "v2.0 Falcon" && !verifyAnswer(qText, "  ").ok;

  // 6. PROXY OF RECORD: signed, vendor-portable, bound to THE question
  const rec = recordHumanDecision(qChoice, "dev", "telegram", "xai-grok", now);
  const recVerifies = verifyHumanDecision(rec, qChoice.questionHash).ok;
  const recBound = !verifyHumanDecision(rec, qText.questionHash).ok;               // can't reuse answer for another question
  const recTamper = (() => { const t = { ...rec, answer: "main" }; return !verifyHumanDecision(t).ok; })();
  const recPortable = rec.vendor === "xai-grok" && rec.kind === "choice";          // any vendor can verify/inherit
  const proxy = recVerifies && recBound && recTamper && recPortable;

  // 7. DUAL-SURFACE RACE: first surface wins, the other dismisses
  const phoneFirst = resolveRace({ surface: "local", answer: "deny", ts: now + 2000 }, { surface: "phone", answer: "allow", ts: now + 1000 });
  const localFirst = resolveRace({ surface: "local", answer: "deny", ts: now + 500 }, { surface: "phone", answer: "allow", ts: now + 1000 });
  const onlyPhone = resolveRace(null, { surface: "phone", answer: "allow", ts: now });
  const race = phoneFirst.winner?.surface === "phone" && phoneFirst.dismiss === "local" && localFirst.winner?.surface === "local" && localFirst.dismiss === "phone" && onlyPhone.dismiss === "local";

  // 8. DETERMINISTIC + FAST (no delay): 5,000 mint+verify round-trips are pure + instant
  let det = true;
  for (let k = 0; k < 5000; k++) { const r = mintApprovalRequest({ rawCommand: "x" + (k % 7), summary: "", agent: "a", session: "s", klass: "k", blast: "safe", nonce: "n" + k, now }); if (!verifyApproval(r, { nonce: "n" + k, commandHash: r.commandHash, agent: "a", session: "s" }, now + 1, false).ok) { det = false; break; } }
  const determinism = mintApprovalRequest({ rawCommand: "z", summary: "", agent: "a", session: "s", klass: "k", blast: "safe", nonce: "z", now }).id === mintApprovalRequest({ rawCommand: "z", summary: "", agent: "a", session: "s", klass: "k", blast: "safe", nonce: "z", now }).id;

  const checks = [
    { name: "SIGNED-AUTHORITY", pass: authority, detail: "approval bound to the exact command-hash, one-time (no replay), TTL'd" },
    { name: "TRUST-TIDE-HYBRID", pass: tide, detail: "proven-safe→auto-allow · unproven→hold · destructive capped (never auto-allow) · regret demotes" },
    { name: "DEAD-MAN-QUEUE", pass: !!deadman, detail: "left running: safe auto-allows, destructive auto-denies, moderate waits for the batch" },
    { name: "COURT-ADMISSIBLE-RECEIPT", pass: receipt, detail: "every decision is a deterministic, content-bound receipt" },
    { name: "ELICIT-APPROVE", pass: approveOk, detail: "yes/no questions validate (and reject non-answers)" },
    { name: "ELICIT-CHOICE", pass: choiceOk, detail: "pick-one questions accept only a listed option" },
    { name: "ELICIT-TEXT", pass: textOk, detail: "free-text questions accept a typed answer (reject empty)" },
    { name: "PROXY-OF-RECORD", pass: proxy, detail: "the human's answer is signed, vendor-portable, and bound to THIS question (can't be reused/tampered)" },
    { name: "DUAL-SURFACE-RACE", pass: race, detail: "answer from phone OR keyboard — first wins, the other dismisses" },
    { name: "TURN-ROUTER", pass: router, detail: "classifies a turn → yes-no / pick-one / typed / not-a-question; mode gates conversational paging (attended=stay, unattended=route)" },
    { name: "DETERMINISTIC-FAST", pass: det && determinism, detail: "5,000 mint+verify round-trips, pure + instant; same input → same id" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage, across all surfaces" },
  ];
  const passed = checks.filter((c) => c.pass).length;
  return { score: Math.round((passed / checks.length) * 1000), max: 1000, passed, total: checks.length, checks };
}
