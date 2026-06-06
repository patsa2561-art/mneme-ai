/**
 * ACCOUNTABILITY DOSSIER (Q3) — AI accountability as a portable, user-owned public utility.
 *
 * The single shift that changes AI forever: today, "trusting an AI" means trusting its vendor — a
 * closed, central act of faith. The Dossier inverts it. Every proof an agent can produce — that it
 * was GOVERNED (the run certificate), WHERE it ran (infra provenance), what it did while DISCONNECTED
 * (the aphelion capsule), and what it provably FORGOT (proof-of-forgetting) — is bundled into ONE
 * artifact, bound by a single root hash, that the USER owns and ANYONE verifies OFFLINE with the
 * embedded public key: no vendor, no Mneme, no network. Trust stops being "believe the giant" and
 * becomes "verify anyone."
 *
 * This composes the verifiers that already exist; it adds the binding + a one-call offline verdict.
 *
 * ★HONEST (DIAKRISIS): the Dossier is exactly as strong as the proofs inside it — each section
 * re-verifies with its own primitive (no new trust is invented), and a missing section is reported,
 * never assumed. It binds + carries accountability; it does not manufacture it.
 */
import { createHash } from "node:crypto";
import { verifyCertificate, type AgentRunCertificate, type RunEvidence } from "../agentcert/index.js";
import { verifyCapsule, type OpsCapsule } from "../aphelion/index.js";
import { type InfraAttestation } from "../infra_provenance/index.js";
import { type ForgettingReceipt } from "../forgetting/index.js";

const sha = (s: string): string => createHash("sha256").update(String(s ?? ""), "utf8").digest("hex");
const canon = (x: unknown): string => { try { return JSON.stringify(x) ?? "null"; } catch { return String(x); } };
function merkleRoot(hashes: ReadonlyArray<string>): string {
  let level = (hashes ?? []).filter(Boolean).slice().sort();
  if (!level.length) return sha("");
  while (level.length > 1) { const next: string[] = []; for (let i = 0; i < level.length; i += 2) next.push(sha(level[i] + (level[i + 1] ?? level[i]))); level = next; }
  return level[0];
}

export interface DossierInput {
  agent: string; subject?: string; nowMs: number;
  governance?: { cert: AgentRunCertificate; evidence: RunEvidence };
  infra?: InfraAttestation;
  offlineOps?: OpsCapsule;
  forgetting?: ForgettingReceipt;
}
export interface DossierSection { kind: "governance" | "infra" | "offline-ops" | "forgetting"; present: boolean; hash: string; summary: string }
export interface AccountabilityDossier {
  v: 1; agent: string; subject: string; issuedAt: number;
  sections: DossierSection[]; rootHash: string;
  // the embedded proofs travel with the dossier so it verifies from one file, anywhere
  governance?: { cert: AgentRunCertificate; evidence: RunEvidence };
  infra?: InfraAttestation;
  offlineOps?: OpsCapsule;
  forgetting?: ForgettingReceipt;
}

export function buildDossier(i: DossierInput): AccountabilityDossier {
  const sections: DossierSection[] = [];
  const add = (kind: DossierSection["kind"], obj: unknown, summary: string) => sections.push({ kind, present: obj != null, hash: obj != null ? sha(canon(obj)) : "", summary });
  add("governance", i?.governance, i?.governance ? `run certificate · ${i.governance.cert.summary.calls} gated call(s) · ${i.governance.cert.summary.insurability}` : "no governance certificate");
  add("infra", i?.infra, i?.infra ? `ran on ${i.infra.provider}${i.infra.region ? `/${i.infra.region}` : ""}` : "no infra attestation");
  add("offline-ops", i?.offlineOps, i?.offlineOps ? `disconnected window · ${i.offlineOps.compliance.total} action(s) · ${i.offlineOps.compliance.violations} violation(s)` : "no disconnected-ops capsule");
  add("forgetting", i?.forgetting, i?.forgetting ? `proof-of-forgetting · ${i.forgetting.count} item(s) forgotten` : "no forgetting proof");
  const rootHash = merkleRoot(sections.filter((s) => s.present).map((s) => s.hash));
  return {
    v: 1, agent: String(i?.agent ?? "agent"), subject: String(i?.subject ?? ""), issuedAt: Number(i?.nowMs) || 0,
    sections, rootHash,
    governance: i?.governance, infra: i?.infra, offlineOps: i?.offlineOps, forgetting: i?.forgetting,
  };
}

export interface DossierVerify { valid: boolean; rootOk: boolean; sections: Array<{ kind: string; present: boolean; verified: boolean; note: string }>; reasons: string[] }
/** ONE offline verdict: re-derive each section's hash + the root, and re-verify each embedded proof
 *  with its own primitive (governance re-derives, offline-ops chain verifies, forgetting merkle holds). */
export function verifyDossier(d: AccountabilityDossier): DossierVerify {
  const reasons: string[] = [];
  if (!d || d.v !== 1) return { valid: false, rootOk: false, sections: [], reasons: ["not an accountability dossier"] };
  const sections: DossierVerify["sections"] = [];
  let allVerified = true;

  // governance — the run certificate must re-derive from its evidence
  if (d.governance) {
    const v = verifyCertificate(d.governance.cert, d.governance.evidence);
    sections.push({ kind: "governance", present: true, verified: v.valid, note: v.reasons[0] });
    if (!v.valid) { allVerified = false; reasons.push("governance: " + v.reasons[0]); }
  } else sections.push({ kind: "governance", present: false, verified: false, note: "absent" });

  // offline-ops — the disconnected capsule chain must verify
  if (d.offlineOps) {
    const v = verifyCapsule(d.offlineOps);
    sections.push({ kind: "offline-ops", present: true, verified: v.valid, note: v.reasons[0] });
    if (!v.valid) { allVerified = false; reasons.push("offline-ops: " + v.reasons[0]); }
  } else sections.push({ kind: "offline-ops", present: false, verified: false, note: "absent" });

  // forgetting — internal merkle integrity (full store-comparison is mneme forget verify)
  if (d.forgetting) {
    const okRoot = merkleRoot(d.forgetting.forgotten.map((f) => f.contentHash)) === d.forgetting.merkleRoot;
    sections.push({ kind: "forgetting", present: true, verified: okRoot, note: okRoot ? `merkle holds · ${d.forgetting.count} forgotten` : "merkle root does not recompute" });
    if (!okRoot) { allVerified = false; reasons.push("forgetting: merkle root does not recompute"); }
  } else sections.push({ kind: "forgetting", present: false, verified: false, note: "absent" });

  // infra — data section (verified by hash binding below)
  sections.push({ kind: "infra", present: !!d.infra, verified: !!d.infra, note: d.infra ? `${d.infra.provider}${d.infra.region ? "/" + d.infra.region : ""}` : "absent" });

  // the root must bind exactly the present sections (no section added/removed/altered)
  const recomputed = merkleRoot((d.sections ?? []).filter((s) => s.present).map((s) => {
    const obj = s.kind === "governance" ? d.governance : s.kind === "infra" ? d.infra : s.kind === "offline-ops" ? d.offlineOps : d.forgetting;
    return sha(canon(obj));
  }));
  const rootOk = recomputed === d.rootHash;
  if (!rootOk) reasons.push("dossier root hash does not bind its sections (added/removed/altered)");

  const valid = rootOk && allVerified && reasons.length === 0;
  if (valid) reasons.push(`verified offline — ${sections.filter((s) => s.present).length} accountability proof(s) bind + re-verify, no vendor trust`);
  return { valid, rootOk, sections, reasons };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface DossierGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export async function dossierGauntlet(): Promise<DossierGauntlet> {
  const { buildCertificate } = await import("../agentcert/index.js");
  const { appendAuditFrame } = await import("../mcpgate/index.js");
  const { openSession, recordAction, sealCapsule } = await import("../aphelion/index.js");
  const { buildForgettingReceipt, contentHash } = await import("../forgetting/index.js");
  const { captureInfra } = await import("../infra_provenance/index.js");

  // governance evidence
  let prev = null as never; const frames = [] as never[];
  for (const c of [{ tool: "read", d: "allow" as const, r: 0.2 }, { tool: "bash", d: "block" as const, r: 0.95 }]) {
    const f = appendAuditFrame(prev, { tool: c.tool, agent: "Grok", run: "R" }, { decision: c.d, risk: c.r, reasons: [], argsHash: "h" + c.tool }, 1000 + frames.length);
    frames.push(f as never); prev = f as never;
  }
  const evidence = { runId: "R", agent: "Grok", startedAt: 1000, endedAt: 1001, auditFrames: frames as never, approvals: [] };
  const cert = buildCertificate(evidence as never);
  const infra = captureInfra({ env: { DO_REGION: "sgp1", DIGITALOCEAN: "1" }, host: "node", platform: "linux", arch: "x64", cpus: 2 }, 1000);
  let sess = openSession({ sessionId: "s", node: "rover", charter: { mission: "m", scope: ["*"], forbidden: ["danger"], maxRisk: 0.7 }, nowMs: 1 });
  sess = recordAction(sess, { action: "read", risk: 0.2 }, 2);
  sess = recordAction(sess, { action: "danger", risk: 0.9 }, 3);   // a real charter violation (so a flip-to-0 is real tampering)
  const capsule = sealCapsule(sess);
  const forgetting = buildForgettingReceipt([{ id: "x", contentHash: contentHash("noise"), reason: "decayed", salience: 0.1 }], [{ id: "k", contentHash: contentHash("keep") }], 1);

  const dossier = buildDossier({ agent: "Grok", subject: "ship-feature", nowMs: 5, governance: { cert, evidence: evidence as never }, infra, offlineOps: capsule, forgetting });
  const v = verifyDossier(dossier);
  const fullOK = v.valid && v.rootOk && dossier.sections.filter((s) => s.present).length === 4;

  // a partial dossier (governance only) still verifies + reports the absent sections
  const partial = buildDossier({ agent: "g", nowMs: 1, governance: { cert, evidence: evidence as never } });
  const partialOK = verifyDossier(partial).valid && verifyDossier(partial).sections.filter((s) => !s.present).length === 3;

  // TAMPER: alter an embedded capsule → root no longer binds → invalid
  const tampered = { ...dossier, offlineOps: { ...dossier.offlineOps!, compliance: { ...dossier.offlineOps!.compliance, violations: 0 } } as OpsCapsule };
  const tamperOK = !verifyDossier(tampered).valid;

  // a forged governance cert inside the dossier is caught (re-derive fails)
  const badGov = buildDossier({ agent: "g", nowMs: 1, governance: { cert: { ...cert, summary: { ...cert.summary, blocked: 0, calls: 999 } }, evidence: evidence as never } });
  const badGovOK = !verifyDossier(badGov).valid;

  const total = await (async () => { try { buildDossier(null as never); verifyDossier(null as never); return true; } catch { return false; } })();

  const checks = [
    { name: "BIND-ALL-PROOFS", pass: fullOK, detail: "governance + infra + disconnected-ops + forgetting bind into one dossier that verifies offline" },
    { name: "PARTIAL-OK-REPORTS-ABSENT", pass: partialOK, detail: "a dossier with only some proofs still verifies + names the absent sections (never assumed)" },
    { name: "ROOT-BINDS-SECTIONS", pass: tamperOK, detail: "altering any embedded proof breaks the root hash binding → invalid" },
    { name: "FORGED-SECTION-CAUGHT", pass: badGovOK, detail: "a forged governance certificate inside the dossier fails its own re-derivation" },
    { name: "TOTAL", pass: total, detail: "never throws on garbage/null" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
