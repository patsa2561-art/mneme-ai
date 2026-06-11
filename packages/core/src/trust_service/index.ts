/**
 * TRUST GATEWAY SERVICE — the front door of the AI-native trust SaaS.
 *
 * Mneme's trust suite, exposed as a stateless HTTP service any AI agent (any vendor, any machine, no
 * install) can POST to and get a signed verdict back. This is "software-as-a-service in the AI world":
 * the consumer is an agent, the payload is a proposed change, the response is PASS / WARN / BLOCK + the
 * reasons — not a website, not a UI.
 *
 * This module owns the pure ROUTER: given a request {path, body}, dispatch to the right engine and return
 * {status, json}. It is STATELESS — the agent sends the data it has (the change's code/files, the
 * baseline + current file set, a policy, outcome records) and gets a verdict; no git, no filesystem, no
 * tenant state on the server. The CLI wraps this in node:http (and adds /equiv, which needs a sandbox).
 *
 * Endpoints:
 *   GET  /health            → liveness + the endpoint catalog
 *   POST /scar/check        → the scar vaccine (PREVENT): {code, files, scars?}
 *   POST /firewall/check    → the architectural firewall (VERIFY): {baselineFiles, currentFiles, policy?}
 *   POST /change-gate       → the one-call gate (PREVENT+VERIFY): {baselineFiles, currentFiles, code, files, policy?}
 *   POST /agent-rep         → reputation (ACCOUNT): {records?} or {commits?}
 *
 * ★HONEST (DIAKRISIS): stateless means no git on the server, so the firewall's AGE-weighting (which needs
 * history) is absent here — severity falls back to the declared policy + base-by-kind (the CLI, which has
 * the repo, does the age-weighted version). Each verdict is exactly as strong as the data the caller
 * sends. The service computes + signs; it does not fetch the caller's repo.
 */
import { vaccinate, BUILTIN_SCARS, type Scar } from "../scar_vaccine/index.js";
import { firewall, loadPolicy } from "../arch_firewall/index.js";
import { composeGate } from "../change_gate/index.js";
import { scoreReputation, deriveOutcomes } from "../agent_ledger/index.js";
import { type SourceFile } from "../cross_layer_graph/index.js";

export interface TrustRequest { method: string; path: string; body: Record<string, unknown> }
export interface TrustResponse { status: number; json: Record<string, unknown> }

export const TRUST_ENDPOINTS = [
  { method: "GET", path: "/health", what: "liveness + endpoint catalog" },
  { method: "POST", path: "/scar/check", what: "scar vaccine (PREVENT) — {code, files, scars?}" },
  { method: "POST", path: "/firewall/check", what: "architectural firewall (VERIFY) — {baselineFiles, currentFiles, policy?}" },
  { method: "POST", path: "/change-gate", what: "the one-call gate (PREVENT+VERIFY) — {baselineFiles, currentFiles, code, files, policy?}" },
  { method: "POST", path: "/agent-rep", what: "agent reputation (ACCOUNT) — {records?} | {commits?}" },
];

const asFiles = (v: unknown): SourceFile[] => Array.isArray(v) ? (v as unknown[]).map((f) => { const o = (f ?? {}) as Record<string, unknown>; return { path: String(o["path"] ?? ""), content: String(o["content"] ?? "") }; }).filter((f) => f.path) : [];
const asStrings = (v: unknown): string[] => Array.isArray(v) ? (v as unknown[]).map((x) => String(x)) : [];

/** Stateless trust router. Pure: same request → same response (no git, no fs, no clock except an injectable today). */
export function routeTrust(req: TrustRequest, opts?: { today?: string }): TrustResponse {
  const path = (req?.path || "").replace(/\/+$/, "") || "/";
  const m = (req?.method || "GET").toUpperCase();
  const body = (req?.body ?? {}) as Record<string, unknown>;
  const today = opts?.today;

  if (path === "/health" || path === "/") return { status: 200, json: { ok: true, service: "mneme-trust-gateway", endpoints: TRUST_ENDPOINTS } };

  if (m !== "POST") return { status: 405, json: { error: "method not allowed", path } };

  if (path === "/scar/check") {
    const scars: Scar[] = [...BUILTIN_SCARS, ...((Array.isArray(body["scars"]) ? body["scars"] : []) as Scar[])];
    const v = vaccinate({ code: String(body["code"] ?? ""), files: asStrings(body["files"]) }, scars);
    return { status: 200, json: { fires: v.fires, firing: v.firing.map((h) => ({ id: h.scar.id, severity: h.scar.severity, lesson: h.scar.lesson, antibodies: h.scar.antibodies })), immune: v.immune.map((h) => ({ id: h.scar.id, antibody: h.antibody })), report: v.report } };
  }

  if (path === "/firewall/check") {
    const fw = firewall(asFiles(body["baselineFiles"]), asFiles(body["currentFiles"]), loadPolicy(String(body["policy"] ?? "")), { today });
    return { status: 200, json: { verdict: fw.verdict, critical: fw.critical, high: fw.high, blocked: fw.blocked, findings: fw.findings, baselineContracts: fw.baselineContracts, note: "stateless: age-weighting absent (no git) — declared policy + base-by-kind apply" } };
  }

  if (path === "/change-gate") {
    const base = asFiles(body["baselineFiles"]), cur = asFiles(body["currentFiles"]);
    const fw = (base.length || cur.length) ? firewall(base, cur, loadPolicy(String(body["policy"] ?? "")), { today }) : null;
    const scars: Scar[] = [...BUILTIN_SCARS, ...((Array.isArray(body["scars"]) ? body["scars"] : []) as Scar[])];
    const scar = (body["code"] || body["files"]) ? vaccinate({ code: String(body["code"] ?? ""), files: asStrings(body["files"]) }, scars) : null;
    const g = composeGate(fw, scar);
    return { status: 200, json: { verdict: g.verdict, reasons: g.reasons, firewall: g.firewall, scar: g.scar } };
  }

  if (path === "/agent-rep") {
    let records = Array.isArray(body["records"]) ? (body["records"] as Array<{ agent: string; outcome: "survived" | "reverted" | "incident" | "pending" }>) : null;
    if (!records && Array.isArray(body["commits"])) records = deriveOutcomes(body["commits"] as never, { matureDays: Number(body["matureDays"]) || 30 });
    const rep = scoreReputation(records ?? []).filter((r) => r.decided > 0);
    return { status: 200, json: { agents: rep } };
  }

  return { status: 404, json: { error: "no such endpoint", path, endpoints: TRUST_ENDPOINTS.map((e) => `${e.method} ${e.path}`) } };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface TrustServiceGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function trustServiceGauntlet(): TrustServiceGauntlet {
  const health = routeTrust({ method: "GET", path: "/health", body: {} });
  const healthOK = health.status === 200 && (health.json["endpoints"] as unknown[]).length >= 4;

  const scar = routeTrust({ method: "POST", path: "/scar/check", body: { files: ["payments/retry.ts"], code: "async function chargeWithRetry(req){ for(let i=0;i<3;i++){ await charge(req); } }" } });
  const scarOK = scar.status === 200 && scar.json["fires"] === true && (scar.json["firing"] as unknown[]).some((f) => /double-charge/.test((f as Record<string, unknown>)["id"] as string));

  const base: SourceFile[] = [{ path: "schema.prisma", content: "model Wallet { id Int @id }" }, { path: "a.ts", content: "export function charge(){ return prisma.wallet.create({data:{}}); }" }];
  const broke: SourceFile[] = [...base, { path: "b.ts", content: "export function drain(){ return prisma.wallet.update({where:{}}); }" }];
  const fw = routeTrust({ method: "POST", path: "/firewall/check", body: { baselineFiles: base, currentFiles: broke, policy: "critical table wallet single-writer" } });
  const fwOK = fw.status === 200 && fw.json["verdict"] === "BLOCK";

  const gate = routeTrust({ method: "POST", path: "/change-gate", body: { baselineFiles: base, currentFiles: broke, policy: "critical table wallet single-writer", files: ["payments/retry.ts"], code: "for(let i=0;i<3;i++){ await charge(req); }" } });
  const gateOK = gate.status === 200 && gate.json["verdict"] === "BLOCK" && (gate.json["reasons"] as string[]).some((r) => /SCAR|contract/.test(r));

  const rep = routeTrust({ method: "POST", path: "/agent-rep", body: { records: [...Array.from({ length: 25 }, () => ({ agent: "good", outcome: "survived" })), ...Array.from({ length: 8 }, () => ({ agent: "bad", outcome: "reverted" }))] } });
  const repOK = rep.status === 200 && (rep.json["agents"] as Array<{ agent: string; band: string }>).find((a) => a.agent === "good")?.band === "TRUSTED";

  const notFound = routeTrust({ method: "POST", path: "/nope", body: {} }).status === 404;
  const methodGuard = routeTrust({ method: "GET", path: "/scar/check", body: {} }).status === 405;
  const total = (() => { try { routeTrust(null as never); routeTrust({ method: "POST", path: "/change-gate", body: {} }); return true; } catch { return false; } })();

  const checks = [
    { name: "HEALTH+CATALOG", pass: healthOK, detail: "GET /health returns liveness + the endpoint catalog" },
    { name: "SCAR-ENDPOINT", pass: scarOK, detail: "POST /scar/check fires the double-charge scar on a non-idempotent retry" },
    { name: "FIREWALL-ENDPOINT", pass: fwOK, detail: "POST /firewall/check BLOCKs a critical contract break" },
    { name: "CHANGE-GATE-ENDPOINT", pass: gateOK, detail: "POST /change-gate fuses scar+firewall into one BLOCK + reasons" },
    { name: "AGENT-REP-ENDPOINT", pass: repOK, detail: "POST /agent-rep scores a durable author TRUSTED" },
    { name: "404+405+TOTAL", pass: notFound && methodGuard && total, detail: "unknown path → 404; wrong method → 405; null/empty never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
