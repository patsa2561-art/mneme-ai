/**
 * THE APPROVAL MATRIX — one authoritative ticket every surface reconciles against.
 *
 * The bug this kills: an approval is broadcast to Telegram + LINE + Slack + Discord + WhatsApp + the
 * computer; the user taps "approve" on ONE, but the others still show live buttons (double-tap), and
 * a freshly-opened computer / AI-chat has no idea it was already decided. Root cause: there was no
 * single source of truth — each surface answered into its own lane.
 *
 * The fix is a state machine, not more glue. ONE ApprovalTicket per request is the authority. A
 * decision is an ATOMIC compare-and-set: the FIRST writer (any surface, any process — the blocking
 * hook, the long-poll daemon, a relay webhook, the computer CLI) wins; everyone else reads
 * "already decided by <who> on <where>" and never double-acts. After a decision lands, a single
 * idempotent reconcile plan clears every OTHER surface exactly once. The computer is a first-class
 * surface, so "approve from the machine you're sitting at" and "approve from your phone" are the
 * same operation against the same ticket — whichever happens first wins, the other clears.
 *
 * Pure + deterministic (the CLI wraps applyDecision in a file lock for cross-process atomicity, and
 * runs reconcilePlan's clears through the provider adapters). DEFAULT is all surfaces; a caller may
 * open a ticket on an explicit subset (when the user told the agent "only line + whatsapp").
 */

export type SurfaceKind = "telegram" | "line" | "slack" | "discord" | "whatsapp" | "computer";
export const BROADCAST_SURFACES: readonly SurfaceKind[] = ["telegram", "line", "slack", "discord", "whatsapp", "computer"];
/** Providers whose original message can be edited in place; others get a follow-up "answered" note. */
const EDITABLE = new Set<string>(["telegram", "slack", "discord"]);
export function surfaceCanEdit(provider: string): boolean { return EDITABLE.has(String(provider)); }

export interface Surface { provider: string; messageId?: string; chatId?: string }
export type TicketKind = "approve" | "choice" | "text";

export interface ApprovalTicket {
  id: string; command: string; agent: string; kind: TicketKind; createdAt: number;
  surfaces: Surface[];                 // every place this ask was offered (includes "computer")
  decision: string | null;            // "allow" | "deny" | <choice> | <text>, or null while open
  decidedBy: string | null;           // "human" | "deadman" | "trust-tide"
  decidedOn: string | null;           // the surface that answered first
  decidedAt: number | null;
  cleared: string[];                   // surfaces already reconciled (idempotency ledger)
}

export interface OpenTicketInput { id: string; command: string; agent: string; kind?: TicketKind; createdAt: number; surfaces?: Array<Surface | string> }
export function openTicket(i: OpenTicketInput): ApprovalTicket {
  const raw = (i?.surfaces && i.surfaces.length ? i.surfaces : BROADCAST_SURFACES.slice());
  const surfaces: Surface[] = raw.map((s) => (typeof s === "string" ? { provider: s } : { provider: String(s?.provider ?? ""), messageId: s?.messageId, chatId: s?.chatId })).filter((s) => s.provider);
  // de-dupe by provider, keep the richest (with messageId) entry
  const byProv = new Map<string, Surface>();
  for (const s of surfaces) { const prev = byProv.get(s.provider); if (!prev || (!prev.messageId && s.messageId)) byProv.set(s.provider, s); }
  return { id: String(i?.id ?? ""), command: String(i?.command ?? ""), agent: String(i?.agent ?? "agent"), kind: (i?.kind ?? "approve"), createdAt: Number(i?.createdAt) || 0, surfaces: [...byProv.values()], decision: null, decidedBy: null, decidedOn: null, decidedAt: null, cleared: [] };
}

/** Attach/refresh the messageId for a surface once a provider returns it (after the broadcast send). */
export function attachSurface(ticket: ApprovalTicket, s: Surface): ApprovalTicket {
  if (!ticket || !s?.provider) return ticket;
  const surfaces = ticket.surfaces.some((x) => x.provider === s.provider)
    ? ticket.surfaces.map((x) => (x.provider === s.provider ? { ...x, messageId: s.messageId ?? x.messageId, chatId: s.chatId ?? x.chatId } : x))
    : [...ticket.surfaces, { provider: s.provider, messageId: s.messageId, chatId: s.chatId }];
  return { ...ticket, surfaces };
}

export interface DecisionInput { decision: string; on: string; by?: string; at: number }
export type DecisionOutcome = "accepted" | "already-decided" | "invalid";
export interface DecisionResult { ticket: ApprovalTicket; outcome: DecisionOutcome; firstWinner: boolean }
/** ATOMIC first-wins compare-and-set (pure). Accept iff the ticket is still open. The CLI runs this
 *  inside a file lock so two near-simultaneous taps (phone + computer) can't both be accepted. */
export function applyDecision(ticket: ApprovalTicket, d: DecisionInput): DecisionResult {
  if (!ticket || typeof ticket !== "object") return { ticket, outcome: "invalid", firstWinner: false };
  const decision = String(d?.decision ?? "").trim();
  if (!decision) return { ticket, outcome: "invalid", firstWinner: false };
  if (ticket.decision !== null) return { ticket, outcome: "already-decided", firstWinner: false };   // someone already won
  const decided: ApprovalTicket = { ...ticket, decision, decidedBy: String(d?.by ?? "human"), decidedOn: String(d?.on ?? "unknown"), decidedAt: Number(d?.at) || 0 };
  return { ticket: decided, outcome: "accepted", firstWinner: true };
}

export interface ClearAction { provider: string; messageId?: string; method: "edit" | "notify"; text: string }
export interface ReconcilePlan { clears: ClearAction[]; alreadyCleared: string[] }
/** The idempotent set of surfaces to update after a decision: every surface EXCEPT the one that
 *  answered and the ones already cleared. Editable providers edit-in-place; others get a note. */
export function reconcilePlan(ticket: ApprovalTicket): ReconcilePlan {
  if (!ticket || ticket.decision === null) return { clears: [], alreadyCleared: [] };
  const note = clearedNote(ticket);
  const done = new Set(ticket.cleared ?? []);
  const clears: ClearAction[] = [];
  for (const s of ticket.surfaces ?? []) {
    if (s.provider === ticket.decidedOn) continue;     // the surface that answered already shows the result
    if (done.has(s.provider)) continue;                // idempotent — already reconciled
    clears.push({ provider: s.provider, messageId: s.messageId, method: surfaceCanEdit(s.provider) ? "edit" : "notify", text: note });
  }
  return { clears, alreadyCleared: [...done] };
}
/** Record that surfaces were reconciled, so a retry/next tick won't clear them again. */
export function markCleared(ticket: ApprovalTicket, providers: ReadonlyArray<string>): ApprovalTicket {
  const set = new Set([...(ticket.cleared ?? []), ...providers.filter(Boolean)]);
  return { ...ticket, cleared: [...set] };
}

function verb(ticket: ApprovalTicket): string {
  if (ticket.kind !== "approve") return `answered "${ticket.decision}"`;
  return ticket.decision === "allow" ? "APPROVED" : "DENIED";
}
/** The message a not-the-decider surface shows: "✅ Already APPROVED by human on telegram — no action needed". */
export function clearedNote(ticket: ApprovalTicket): string {
  const icon = ticket.kind === "approve" ? (ticket.decision === "allow" ? "✅" : "⛔") : "✅";
  return `${icon} Already ${verb(ticket)} by ${ticket.decidedBy ?? "human"} on ${ticket.decidedOn ?? "another channel"} — no action needed.`;
}
/** The reply a LATE tapper gets (they tapped after someone else already decided). */
export function alreadyDecidedReply(ticket: ApprovalTicket, lateSurface: string): string {
  return `This was already ${verb(ticket)} by ${ticket.decidedBy ?? "human"} on ${ticket.decidedOn ?? "another channel"}${lateSurface ? ` (you tapped on ${lateSurface})` : ""}. Nothing more to do.`;
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ApprovalMatrixGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function approvalMatrixGauntlet(): ApprovalMatrixGauntlet {
  const base = () => openTicket({ id: "t1", command: "rm -rf build", agent: "Grok", createdAt: 100, surfaces: [{ provider: "telegram", messageId: "tg9" }, { provider: "line", messageId: "ln3" }, { provider: "slack", messageId: "sl2" }, "whatsapp", "computer"] });

  // default = all 6 broadcast surfaces when none specified
  const defAll = openTicket({ id: "d", command: "x", agent: "a", createdAt: 1 });
  const defaultOK = defAll.surfaces.length === 6 && defAll.surfaces.some((s) => s.provider === "computer");

  // FIRST-WINS: phone wins; a later computer tap is rejected, decision unchanged
  const t = base();
  const first = applyDecision(t, { decision: "allow", on: "telegram", by: "human", at: 200 });
  const second = applyDecision(first.ticket, { decision: "deny", on: "computer", by: "human", at: 205 });
  const firstWinsOK = first.outcome === "accepted" && first.firstWinner && second.outcome === "already-decided" && second.ticket.decision === "allow" && second.ticket.decidedOn === "telegram";

  // reconcile clears EVERY other surface exactly once, excludes the decider (telegram)
  const plan = reconcilePlan(first.ticket);
  const provs = plan.clears.map((c) => c.provider).sort();
  const reconcileOK = JSON.stringify(provs) === JSON.stringify(["computer", "line", "slack", "whatsapp"]) && !provs.includes("telegram")
    && plan.clears.find((c) => c.provider === "slack")?.method === "edit"      // slack editable
    && plan.clears.find((c) => c.provider === "line")?.method === "notify"     // line → note
    && plan.clears.every((c) => c.text.includes("Already APPROVED") && c.text.includes("telegram"));

  // IDEMPOTENT: after marking line+slack cleared, they don't reappear in the next plan
  const afterMark = markCleared(first.ticket, ["line", "slack"]);
  const plan2 = reconcilePlan(afterMark);
  const idempotentOK = plan2.clears.map((c) => c.provider).sort().join() === ["computer", "whatsapp"].join();

  // COMPUTER can be the first winner; phones then clear
  const t2 = base();
  const compFirst = applyDecision(t2, { decision: "allow", on: "computer", by: "human", at: 300 });
  const compPlan = reconcilePlan(compFirst.ticket);
  const computerWinsOK = compFirst.outcome === "accepted" && compPlan.clears.some((c) => c.provider === "telegram") && !compPlan.clears.some((c) => c.provider === "computer");

  // DENY path
  const t3 = base();
  const den = applyDecision(t3, { decision: "deny", on: "whatsapp", by: "human", at: 400 });
  const denyOK = den.outcome === "accepted" && clearedNote(den.ticket).startsWith("⛔ Already DENIED") && reconcilePlan(den.ticket).clears.every((c) => c.text.includes("DENIED"));

  // choice/text kind still first-wins + readable note
  const tc = openTicket({ id: "c", command: "pick", agent: "a", kind: "choice", createdAt: 1, surfaces: ["telegram", "line"] });
  const ch = applyDecision(tc, { decision: "option B", on: "line", at: 5 });
  const choiceOK = ch.outcome === "accepted" && clearedNote(ch.ticket).includes('answered "option B"') && alreadyDecidedReply(ch.ticket, "telegram").includes("option B");

  // explicit subset (user said "only line + whatsapp")
  const sub = openTicket({ id: "s", command: "x", agent: "a", createdAt: 1, surfaces: ["line", "whatsapp"] });
  const subsetOK = sub.surfaces.length === 2 && !sub.surfaces.some((s) => s.provider === "telegram");

  // attachSurface refreshes a messageId after the send returns it
  const at0 = openTicket({ id: "z", command: "x", agent: "a", createdAt: 1, surfaces: ["discord"] });
  const at1 = attachSurface(at0, { provider: "discord", messageId: "dc7" });
  const attachOK = at1.surfaces.find((s) => s.provider === "discord")?.messageId === "dc7";

  // invalid / total
  const inv = applyDecision(base(), { decision: "", on: "x", at: 1 }).outcome === "invalid";
  const total = (() => { try { openTicket(null as never); applyDecision(null as never, null as never); reconcilePlan(null as never); markCleared({ cleared: [] } as never, [null as never]); return true; } catch { return false; } })();

  const checks = [
    { name: "DEFAULT-ALL-SURFACES", pass: defaultOK, detail: "no subset given → broadcast to all 6 surfaces incl. the computer" },
    { name: "FIRST-WINS-ATOMIC", pass: firstWinsOK, detail: "first decision accepted; a later tap on any surface → already-decided, decision unchanged" },
    { name: "RECONCILE-CLEARS-OTHERS", pass: reconcileOK, detail: "every surface but the decider is cleared once; editable→edit, others→notify; note names who/where" },
    { name: "IDEMPOTENT-CLEAR", pass: idempotentOK, detail: "marked-cleared surfaces never reappear in the plan (safe to retry across ticks/processes)" },
    { name: "COMPUTER-IS-A-SURFACE", pass: computerWinsOK, detail: "approving from the computer wins + clears the phones (sit-at-the-machine = same ticket)" },
    { name: "DENY-PATH", pass: denyOK, detail: "deny first-wins + propagates a DENIED note" },
    { name: "CHOICE-TEXT-KIND", pass: choiceOK, detail: "choice/text answers first-win with a readable note + late reply" },
    { name: "EXPLICIT-SUBSET", pass: subsetOK, detail: "an explicit surface subset is honored (the user told the agent which channels)" },
    { name: "ATTACH-SURFACE", pass: attachOK, detail: "a provider's messageId can be attached after the broadcast send" },
    { name: "INVALID+TOTAL", pass: inv && total, detail: "empty decision → invalid; never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
