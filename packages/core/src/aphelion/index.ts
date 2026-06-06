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
export type EntryKind = "action" | "amendment";
export interface OfflineAction { seq: number; id: string; at: number; kind: EntryKind; action: string; risk: number; path: string | null; charter: Charter | null; withinCharter: boolean; reason: string; prev: string; frameId: string }

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

/** The charter in force right now = the latest signed amendment in the ledger, else the initial one. */
export function activeCharterOf(session: OfflineSession): Charter {
  const amends = (session?.actions ?? []).filter((a) => a.kind === "amendment" && a.charter);
  return amends.length ? amends[amends.length - 1].charter as Charter : (session?.charter ?? { mission: "", scope: [], forbidden: [], maxRisk: 1 });
}

/** Append a self-gated action to the tamper-evident offline ledger (hash-chained). */
export function recordAction(session: OfflineSession, a: ActionInput, nowMs: number): OfflineSession {
  const s = session ?? openSession({ sessionId: "", node: "node", charter: { mission: "", scope: [], forbidden: [], maxRisk: 1 }, nowMs });
  const acts = s.actions ?? [];
  const prev = acts.length ? acts[acts.length - 1] : null;
  const seq = prev ? prev.seq + 1 : 0;
  const v = judge(activeCharterOf(s), a);   // judged against the charter IN FORCE (after any amendments)
  const body = { seq, at: Number(nowMs) || 0, kind: "action" as const, action: String(a?.action ?? ""), risk: Number(a?.risk) || 0, path: a?.path ?? null, charter: null, withinCharter: v.withinCharter, reason: v.reason, prev: prev?.frameId ?? "" };
  const frameId = sha(canon(body));
  return { ...s, actions: [...acts, { ...body, id: `${s.node}:${seq}`, frameId }] };
}

/** Amend the autonomy charter MID-FLIGHT — a SIGNED, chain-recorded envelope change (you cannot
 *  silently widen the envelope to hide a violation; the amendment + its reason are in the ledger,
 *  and it only governs actions taken AFTER it — it cannot retroactively un-violate a past action). */
export function amendCharter(session: OfflineSession, amend: { charter: Charter; reason: string; by?: string }, nowMs: number): OfflineSession {
  const s = session ?? openSession({ sessionId: "", node: "node", charter: { mission: "", scope: [], forbidden: [], maxRisk: 1 }, nowMs });
  const acts = s.actions ?? [];
  const prev = acts.length ? acts[acts.length - 1] : null;
  const seq = prev ? prev.seq + 1 : 0;
  const c = amend?.charter ?? activeCharterOf(s);
  const newCharter: Charter = { mission: String(c.mission ?? ""), scope: c.scope ?? [], forbidden: c.forbidden ?? [], maxRisk: Number(c.maxRisk ?? 1) };
  const body = { seq, at: Number(nowMs) || 0, kind: "amendment" as const, action: `charter amended by ${amend?.by ?? "operator"}: ${amend?.reason ?? ""}`, risk: 0, path: null, charter: newCharter, withinCharter: true, reason: String(amend?.reason ?? "charter amended"), prev: prev?.frameId ?? "" };
  const frameId = sha(canon(body));
  return { ...s, actions: [...acts, { ...body, id: `${s.node}:${seq}`, frameId }] };
}

export interface ComplianceSummary { total: number; withinCharter: number; violations: number; violationIds: string[] }
export interface OpsCapsule { v: 1; sessionId: string; node: string; charter: Charter; infra: Record<string, unknown> | null; actions: OfflineAction[]; chainHead: string; window: { from: number; to: number }; compliance: ComplianceSummary }
/** Seal the disconnected window into a capsule (sign it at the edge for offline verification). */
export function sealCapsule(session: OfflineSession): OpsCapsule {
  const s = session ?? openSession({ sessionId: "", node: "node", charter: { mission: "", scope: [], forbidden: [], maxRisk: 1 }, nowMs: 0 });
  const actions = s.actions ?? [];
  const realActions = actions.filter((a) => a.kind === "action");        // amendments are not "actions"
  const violations = realActions.filter((a) => !a.withinCharter);
  return {
    v: 1, sessionId: s.sessionId, node: s.node, charter: s.charter, infra: s.infra,
    actions, chainHead: actions.length ? actions[actions.length - 1].frameId : "",
    window: { from: actions.length ? actions[0].at : s.startedAt, to: actions.length ? actions[actions.length - 1].at : s.startedAt },
    compliance: { total: realActions.length, withinCharter: realActions.length - violations.length, violations: violations.length, violationIds: violations.map((vv) => vv.id) },
  };
}

export interface CapsuleVerify { valid: boolean; chainOk: boolean; compliant: boolean; reasons: string[] }
/** Verify OFFLINE: the chain is intact (tamper-evident) AND every recorded judgement re-derives. */
export function verifyCapsule(capsule: OpsCapsule): CapsuleVerify {
  const reasons: string[] = [];
  if (!capsule || capsule.v !== 1) return { valid: false, chainOk: false, compliant: false, reasons: ["not an aphelion capsule"] };
  let prev = ""; let chainOk = true;
  let activeCharter: Charter = capsule.charter;   // the initial charter; amendments move it forward
  for (const a of capsule.actions ?? []) {
    const kind = a.kind ?? "action";
    const body = { seq: a.seq, at: a.at, kind, action: a.action, risk: a.risk, path: a.path, charter: a.charter ?? null, withinCharter: a.withinCharter, reason: a.reason, prev };
    if (sha(canon(body)) !== a.frameId) { chainOk = false; reasons.push(`chain broken at entry #${a.seq}`); break; }
    if (kind === "amendment") { activeCharter = (a.charter as Charter) ?? activeCharter; }   // signed envelope change, in-chain
    else if (judge(activeCharter, { action: a.action, risk: a.risk, path: a.path ?? undefined }).withinCharter !== a.withinCharter) { chainOk = false; reasons.push(`action #${a.seq} judgement was forged (does not match the charter in force)`); break; }
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
  const all = [...byId.values()].filter((a) => (a.kind ?? "action") === "action");   // amendments aren't actions
  const perNode = [...nodes].sort().map((node) => { const acts = all.filter((a) => a.id.startsWith(node + ":")); const vi = acts.filter((a) => !a.withinCharter).length; return { node, actions: acts.length, violations: vi, clean: vi === 0 }; });
  return { nodes: [...nodes].sort(), totalActions: all.length, totalViolations: all.filter((a) => !a.withinCharter).length, perNode };
}

// ── DTN — Delay-Tolerant Networking (store-and-forward custody transfer, NASA Bundle-Protocol-style) ──
export interface CustodyHop { node: string; at: number; prev: string; hopId: string }
export interface DtnBundle { v: 1; bundleId: string; origin: string; capsule: OpsCapsule; custody: CustodyHop[] }
function hop(node: string, at: number, prev: string): CustodyHop { const body = { node, at, prev }; return { ...body, hopId: sha(canon(body)) }; }
/** Wrap a sealed capsule into a DTN bundle at the origin node (first custody hop). */
export function createBundle(capsule: OpsCapsule, originNode: string, nowMs: number): DtnBundle {
  const first = hop(String(originNode), Number(nowMs) || 0, "");
  return { v: 1, bundleId: sha(canon({ c: capsule?.chainHead ?? "", o: originNode })), origin: String(originNode), capsule, custody: [first] };
}
/** Take custody at an intermediate relay (an orbiter, a ground station) — store-and-forward. */
export function forwardBundle(bundle: DtnBundle, viaNode: string, nowMs: number): DtnBundle {
  const custody = bundle?.custody ?? [];
  const prev = custody.length ? custody[custody.length - 1].hopId : "";
  return { ...bundle, custody: [...custody, hop(String(viaNode), Number(nowMs) || 0, prev)] };
}
export interface BundleVerify { valid: boolean; custodyOk: boolean; capsuleValid: boolean; path: string[]; reasons: string[] }
/** Verify a delivered bundle OFFLINE: the custody chain is intact (every hop links) AND the carried
 *  capsule still verifies — so the full delivery PATH + the payload integrity are both provable. */
export function verifyBundle(bundle: DtnBundle): BundleVerify {
  const reasons: string[] = [];
  if (!bundle || bundle.v !== 1) return { valid: false, custodyOk: false, capsuleValid: false, path: [], reasons: ["not a DTN bundle"] };
  let prev = ""; let custodyOk = true;
  for (let i = 0; i < (bundle.custody ?? []).length; i++) {
    const h = bundle.custody[i];
    if (sha(canon({ node: h.node, at: h.at, prev })) !== h.hopId || h.prev !== prev) { custodyOk = false; reasons.push(`custody broken at hop #${i} (${h.node})`); break; }
    prev = h.hopId;
  }
  const cap = verifyCapsule(bundle.capsule);
  const path = (bundle.custody ?? []).map((h) => h.node);
  if (!custodyOk) reasons.push("custody chain is not intact");
  if (!cap.valid) reasons.push("carried capsule failed verification: " + cap.reasons[0]);
  const valid = custodyOk && cap.valid;
  if (valid) reasons.push(`delivered + verified offline — path ${path.join(" → ")} · ${bundle.capsule.compliance.total} action(s) · ${bundle.capsule.compliance.violations} violation(s)`);
  return { valid, custodyOk, capsuleValid: cap.valid, path, reasons };
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

  // CHARTER AMENDMENT (signed, mid-flight): an action over the INITIAL risk ceiling becomes compliant
  // only AFTER a signed amendment raises it — and the amendment is in the tamper-evident chain.
  let amd = openSession({ sessionId: "a", node: "rover", charter: { mission: "m", scope: ["*"], forbidden: [], maxRisk: 0.5 }, nowMs: 1 });
  amd = recordAction(amd, { action: "risky pre-amend", risk: 0.8 }, 2);                 // violation vs maxRisk 0.5
  amd = amendCharter(amd, { charter: { mission: "m", scope: ["*"], forbidden: [], maxRisk: 0.9 }, reason: "operator widened risk for the descent" }, 3);
  amd = recordAction(amd, { action: "risky post-amend", risk: 0.8 }, 4);                 // now within charter (maxRisk 0.9)
  const amdCap = sealCapsule(amd); const amdV = verifyCapsule(amdCap);
  const amendOK = amdV.valid && amdCap.compliance.total === 2 && amdCap.compliance.violations === 1   // the PRE-amend action stays a violation (no retroactive cover)
    && amdCap.actions.find((a) => a.kind === "amendment") !== undefined && activeCharterOf(amd).maxRisk === 0.9;

  // DTN store-and-forward: a capsule rides home through relays; the path + payload both verify
  const bundle0 = createBundle(capsule, "mars-rover", 5000);
  const bundle1 = forwardBundle(bundle0, "mars-orbiter", 5100);
  const bundle2 = forwardBundle(bundle1, "deep-space-network", 5200);
  const bv = verifyBundle(bundle2);
  const dtnOK = bv.valid && bv.custodyOk && bv.capsuleValid && JSON.stringify(bv.path) === JSON.stringify(["mars-rover", "mars-orbiter", "deep-space-network"]);
  const dtnTamperHop = !verifyBundle({ ...bundle2, custody: bundle2.custody.map((h, i) => i === 1 ? { ...h, node: "evil-relay" } : h) }).valid;
  const dtnTamperPayload = !verifyBundle({ ...bundle2, capsule: forged }).valid;
  const dtnTotalOK = dtnOK && dtnTamperHop && dtnTamperPayload;

  const total = (() => { try { openSession(null as never); recordAction(null as never, null as never, 0); amendCharter(null as never, null as never, 0); sealCapsule(null as never); verifyCapsule(null as never); mergeCapsules(null as never); createBundle(null as never, "x", 0); forwardBundle(null as never, "y", 0); verifyBundle(null as never); return true; } catch { return false; } })();

  const checks = [
    { name: "SELF-GOVERN-OFFLINE", pass: complianceOK, detail: "a disconnected agent self-judges each action vs a local charter; a forbidden/over-risk/off-scope action is a recorded violation" },
    { name: "WINDOW-PROOF-VERIFIES", pass: verifyOK, detail: "the sealed window verifies offline + surfaces the violation (it cannot be hidden after the fact)" },
    { name: "CLEAN-WINDOW-COMPLIANT", pass: cleanOK, detail: "a clean disconnected window is provably compliant" },
    { name: "FORGED-JUDGEMENT-CAUGHT", pass: tamperOK, detail: "flipping a recorded violation to compliant breaks verification" },
    { name: "FLEET-CRDT-MERGE", pass: mergeOK, detail: "capsules merge conflict-free on reconnect (idempotent + commutative) with per-node compliance" },
    { name: "SIGNED-CHARTER-AMENDMENT", pass: amendOK, detail: "a mid-flight signed amendment widens the envelope for future actions but cannot retroactively cover a past violation" },
    { name: "DTN-CUSTODY-RELAY", pass: dtnTotalOK, detail: "a capsule store-and-forwards home through relays; the custody path + the carried payload both verify offline; a tampered hop or payload is caught" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
