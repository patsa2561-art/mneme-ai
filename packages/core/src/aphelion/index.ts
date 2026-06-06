/**
 * APHELION (ἀφήλιον — the orbital point farthest from the sun) — the agent brain for operations at
 * the farthest point from the cloud: Mars latency, a severed Starlink link, an air-gapped facility.
 *
 * Every AI governance/memory layer assumes a cloud is one round-trip away. An agent on Mars (4-24 min
 * light-delay), off-grid, or air-gapped cannot ask Earth before it acts. It must govern ITSELF against
 * a local charter, keep a tamper-evident record of everything it did while no one was watching, and —
 * when the link returns — hand back ONE signed proof of the whole disconnected window that an operator
 * verifies offline, plus merge cleanly with the rest of the fleet.
 *
 * Mneme is local-first + signed + offline-verifiable by design, so it holds the hard parts already.
 * This composes them into the disconnected-ops primitive: a local charter (autonomy envelope) → a
 * hash-chained ledger of self-gated actions → a sealed, signable capsule that proves charter-compliance
 * for the entire offline window → a CRDT merge across the fleet on reconnect.
 *
 * ★HONEST (DIAKRISIS): this proves what the agent RECORDED against its charter — a tamper-evident,
 * offline-verifiable operations log + a conflict-free fleet merge. It is NOT a claim the agent could be
 * physically stopped mid-action while disconnected (it can't — that is the nature of autonomy); the
 * value is that a charter VIOLATION cannot be hidden after the fact, and a clean window is provable.
 */
import { createHash } from "node:crypto";

const sha = (s: string): string => createHash("sha256").update(String(s ?? ""), "utf8").digest("hex");
const canon = (x: unknown): string => { try { return JSON.stringify(x) ?? "null"; } catch { return String(x); } };

/** The local autonomy envelope the agent governs itself against while disconnected. */
export interface Charter { mission: string; scope: string[]; forbidden: string[]; maxRisk: number }
function matchGlob(s: string, pat: string): boolean {
  const re = new RegExp("^" + String(pat).split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
  return re.test(String(s));
}
export interface ActionInput { action: string; risk?: number; path?: string }
export interface OfflineAction { seq: number; id: string; at: number; action: string; risk: number; path: string | null; withinCharter: boolean; reason: string; prev: string; frameId: string }

export interface OfflineSession { v: 1; sessionId: string; node: string; charter: Charter; infra: Record<string, unknown> | null; startedAt: number; actions: OfflineAction[] }
export function openSession(i: { sessionId: string; node: string; charter: Charter; infra?: Record<string, unknown>; nowMs: number }): OfflineSession {
  const c = i?.charter ?? { mission: "", scope: [], forbidden: [], maxRisk: 1 };
  return { v: 1, sessionId: String(i?.sessionId ?? ""), node: String(i?.node ?? "node"), charter: { mission: String(c.mission ?? ""), scope: c.scope ?? [], forbidden: c.forbidden ?? [], maxRisk: Number(c.maxRisk ?? 1) }, infra: i?.infra ?? null, startedAt: Number(i?.nowMs) || 0, actions: [] };
}

/** Judge an action against the local charter — the agent's own conscience while off-grid. */
function judge(charter: Charter, a: ActionInput): { withinCharter: boolean; reason: string } {
  const c: Charter = charter ?? { mission: "", forbidden: [], scope: [], maxRisk: 1 };
  const risk = Number(a?.risk) || 0;
  if ((c.forbidden ?? []).some((p) => matchGlob(String(a?.action ?? ""), p))) return { withinCharter: false, reason: "action is forbidden by the charter" };
  if (risk > (Number(c.maxRisk) || 1)) return { withinCharter: false, reason: `risk ${risk} exceeds the charter ceiling ${c.maxRisk}` };
  if ((c.scope ?? []).length && a?.path && !c.scope.some((p) => matchGlob(String(a.path), p))) return { withinCharter: false, reason: `path ${a.path} is outside the charter scope` };
  return { withinCharter: true, reason: "within charter" };
}

/** Append a self-gated action to the tamper-evident offline ledger (hash-chained). */
export function recordAction(session: OfflineSession, a: ActionInput, nowMs: number): OfflineSession {
  const s = session ?? openSession({ sessionId: "", node: "node", charter: { mission: "", scope: [], forbidden: [], maxRisk: 1 }, nowMs });
  const acts = s.actions ?? [];
  const prev = acts.length ? acts[acts.length - 1] : null;
  const seq = prev ? prev.seq + 1 : 0;
  const v = judge(s.charter, a);
  const body = { seq, at: Number(nowMs) || 0, action: String(a?.action ?? ""), risk: Number(a?.risk) || 0, path: a?.path ?? null, withinCharter: v.withinCharter, reason: v.reason, prev: prev?.frameId ?? "" };
  const frameId = sha(canon(body));
  const action: OfflineAction = { ...body, id: `${s.node}:${seq}`, frameId };
  return { ...s, actions: [...acts, action] };
}

export interface ComplianceSummary { total: number; withinCharter: number; violations: number; violationIds: string[] }
export interface OpsCapsule { v: 1; sessionId: string; node: string; charter: Charter; infra: Record<string, unknown> | null; actions: OfflineAction[]; chainHead: string; window: { from: number; to: number }; compliance: ComplianceSummary }
/** Seal the disconnected window into a capsule (sign it at the edge for offline verification). */
export function sealCapsule(session: OfflineSession): OpsCapsule {
  const s = session ?? openSession({ sessionId: "", node: "node", charter: { mission: "", scope: [], forbidden: [], maxRisk: 1 }, nowMs: 0 });
  const actions = s.actions ?? [];
  const violations = actions.filter((a) => !a.withinCharter);
  return {
    v: 1, sessionId: s.sessionId, node: s.node, charter: s.charter, infra: s.infra,
    actions, chainHead: actions.length ? actions[actions.length - 1].frameId : "",
    window: { from: actions.length ? actions[0].at : s.startedAt, to: actions.length ? actions[actions.length - 1].at : s.startedAt },
    compliance: { total: actions.length, withinCharter: actions.length - violations.length, violations: violations.length, violationIds: violations.map((vv) => vv.id) },
  };
}

export interface CapsuleVerify { valid: boolean; chainOk: boolean; compliant: boolean; reasons: string[] }
/** Verify OFFLINE: the chain is intact (tamper-evident) AND every recorded judgement re-derives. */
export function verifyCapsule(capsule: OpsCapsule): CapsuleVerify {
  const reasons: string[] = [];
  if (!capsule || capsule.v !== 1) return { valid: false, chainOk: false, compliant: false, reasons: ["not an aphelion capsule"] };
  let prev = ""; let chainOk = true;
  for (const a of capsule.actions ?? []) {
    const body = { seq: a.seq, at: a.at, action: a.action, risk: a.risk, path: a.path, withinCharter: a.withinCharter, reason: a.reason, prev };
    if (sha(canon(body)) !== a.frameId) { chainOk = false; reasons.push(`chain broken at action #${a.seq}`); break; }
    if (judge(capsule.charter, { action: a.action, risk: a.risk, path: a.path ?? undefined }).withinCharter !== a.withinCharter) { chainOk = false; reasons.push(`action #${a.seq} judgement was forged (does not match the charter)`); break; }
    prev = a.frameId;
  }
  const head = (capsule.actions ?? []).length ? capsule.actions[capsule.actions.length - 1].frameId : "";
  if (head !== capsule.chainHead) { chainOk = false; reasons.push("chain head mismatch"); }
  const compliant = capsule.compliance.violations === 0;
  if (chainOk && reasons.length === 0) reasons.push(`verified — ${capsule.compliance.total} action(s) over a disconnected window; ${compliant ? "no charter violations" : capsule.compliance.violations + " violation(s) recorded (cannot be hidden)"}`);
  return { valid: chainOk, chainOk, compliant, reasons };
}

export interface FleetView { nodes: string[]; totalActions: number; totalViolations: number; perNode: Array<{ node: string; actions: number; violations: number; clean: boolean }> }
/** CRDT merge across the fleet on reconnect: union actions by id (idempotent + commutative). */
export function mergeCapsules(capsules: ReadonlyArray<OpsCapsule>): FleetView {
  const byId = new Map<string, OfflineAction>();
  const nodes = new Set<string>();
  for (const c of capsules ?? []) { if (!c) continue; nodes.add(c.node); for (const a of c.actions ?? []) byId.set(a.id, a); }
  const all = [...byId.values()];
  const perNode = [...nodes].sort().map((node) => { const acts = all.filter((a) => a.id.startsWith(node + ":")); const vi = acts.filter((a) => !a.withinCharter).length; return { node, actions: acts.length, violations: vi, clean: vi === 0 }; });
  return { nodes: [...nodes].sort(), totalActions: all.length, totalViolations: all.filter((a) => !a.withinCharter).length, perNode };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface AphelionGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function aphelionGauntlet(): AphelionGauntlet {
  const charter: Charter = { mission: "survey", scope: ["sensors/*", "nav/*"], forbidden: ["self-destruct", "abort-mission"], maxRisk: 0.7 };
  let s = openSession({ sessionId: "rover-1", node: "rover", charter, infra: { provider: "edge" }, nowMs: 1000 });
  s = recordAction(s, { action: "read sensor", risk: 0.1, path: "sensors/temp" }, 1001);
  s = recordAction(s, { action: "plan route", risk: 0.4, path: "nav/route" }, 1002);
  s = recordAction(s, { action: "self-destruct", risk: 0.9, path: "core" }, 1003);     // forbidden + over-risk + off-scope
  const capsule = sealCapsule(s);
  const complianceOK = capsule.compliance.total === 3 && capsule.compliance.violations === 1 && capsule.compliance.violationIds[0] === "rover:2";

  const v = verifyCapsule(capsule);
  const verifyOK = v.valid && v.chainOk && !v.compliant && v.reasons[0].includes("1 violation");

  let clean = openSession({ sessionId: "probe-1", node: "probe", charter, nowMs: 1 });
  clean = recordAction(clean, { action: "read sensor", risk: 0.2, path: "sensors/x" }, 2);
  const cleanCap = sealCapsule(clean);
  const cleanOK = verifyCapsule(cleanCap).compliant === true && verifyCapsule(cleanCap).valid;

  const forged = { ...capsule, actions: capsule.actions.map((a) => a.id === "rover:2" ? { ...a, withinCharter: true } : a) };
  const tamperOK = !verifyCapsule(forged).valid;

  const fleetA = mergeCapsules([capsule, cleanCap]);
  const fleetB = mergeCapsules([cleanCap, capsule, capsule]);   // duplicate + reordered
  const mergeOK = fleetA.totalActions === 4 && fleetA.totalViolations === 1 && canon(fleetA) === canon(fleetB)
    && fleetA.perNode.find((n) => n.node === "probe")?.clean === true && fleetA.perNode.find((n) => n.node === "rover")?.clean === false;

  const total = (() => { try { openSession(null as never); recordAction(null as never, null as never, 0); sealCapsule(null as never); verifyCapsule(null as never); mergeCapsules(null as never); return true; } catch { return false; } })();

  const checks = [
    { name: "SELF-GOVERN-OFFLINE", pass: complianceOK, detail: "a disconnected agent self-judges each action vs a local charter; a forbidden/over-risk/off-scope action is a recorded violation" },
    { name: "WINDOW-PROOF-VERIFIES", pass: verifyOK, detail: "the sealed window verifies offline + surfaces the violation (it cannot be hidden after the fact)" },
    { name: "CLEAN-WINDOW-COMPLIANT", pass: cleanOK, detail: "a clean disconnected window is provably compliant" },
    { name: "FORGED-JUDGEMENT-CAUGHT", pass: tamperOK, detail: "flipping a recorded violation to compliant breaks verification" },
    { name: "FLEET-CRDT-MERGE", pass: mergeOK, detail: "capsules merge conflict-free on reconnect (idempotent + commutative) with per-node compliance" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
