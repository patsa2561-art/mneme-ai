/**
 * SECURITY POSTURE — the AppSec triad as one answer. "Is this codebase safe for an AI to ship from?"
 *
 * The three deterministic taint checks on the cross-layer graph, run in one pass and fused into a single
 * verdict + posture an agent (or a CISO) can act on:
 *   • AUTHZ GAP  (write)  — user can WRITE a sensitive table with no auth.
 *   • EXFIL PATH (read)   — sensitive data is READ out to the response with no redaction.
 *   • INJECTION  (input)  — user input reaches a dangerous sink with no sanitizer.
 *
 * This module composes the three existing primitives (it adds no new detection) into a unified finding
 * list + a posture score + a verdict. The score-from-counts is the one pure, testable piece; the audit
 * runs the three engines over the graph/files.
 *
 * ★HONEST (DIAKRISIS): the posture is a RELATIVE signal computed from finding counts (a clean scan ≠ a
 * proof of security; a low score ≠ a breach) — and each underlying finding is itself a high-signal
 * CANDIDATE (lexical taint), not a proven exploit. It surfaces where to look first across all three axes;
 * it does not certify the code as secure.
 */
import { authzGaps, type AuthzGap } from "../authz_gap/index.js";
import { exfilPaths, type ExfilPath } from "../exfil_path/index.js";
import { injectionPaths, type InjectionPath } from "../injection_taint/index.js";
import { type CrossLayerGraph } from "../cross_layer_graph/index.js";

export type SecCategory = "authz" | "exfil" | "injection";
export type SecSeverity = "critical" | "high";
export interface SecFinding { category: SecCategory; severity: SecSeverity; where: string; detail: string }
export interface SecurityPosture { verdict: "CLEAR" | "REVIEW" | "AT-RISK"; posture: number; findings: SecFinding[]; counts: { authz: number; exfil: number; injection: number }; }

const WEIGHT: Record<SecCategory, number> = { injection: 22, authz: 20, exfil: 12 };
const SEV: Record<SecCategory, SecSeverity> = { injection: "critical", authz: "critical", exfil: "high" };

/** Posture 0..100 from finding counts; verdict from the worst axis. Pure + testable. */
export function scorePosture(counts: { authz?: number; exfil?: number; injection?: number }): SecurityPosture["verdict"] extends never ? never : { posture: number; verdict: SecurityPosture["verdict"] } {
  const a = Math.max(0, counts?.authz ?? 0), e = Math.max(0, counts?.exfil ?? 0), i = Math.max(0, counts?.injection ?? 0);
  const posture = Math.max(0, 100 - (i * WEIGHT.injection + a * WEIGHT.authz + e * WEIGHT.exfil));
  const verdict: SecurityPosture["verdict"] = (i > 0 || a > 0) ? "AT-RISK" : e > 0 ? "REVIEW" : "CLEAR";
  return { posture, verdict };
}

/** Run all three AppSec axes over the graph/files → one unified posture. */
export function securityAudit(graph: CrossLayerGraph, files: ReadonlyArray<{ path?: string; content?: string }>): SecurityPosture {
  const az: AuthzGap[] = authzGaps(graph);
  const ex: ExfilPath[] = exfilPaths(graph);
  const inj: InjectionPath[] = injectionPaths(graph, files ?? []);
  const findings: SecFinding[] = [
    ...inj.map((p) => ({ category: "injection" as const, severity: SEV.injection, where: `${p.method} ${p.endpoint} → ${p.func}`, detail: p.kind })),
    ...az.map((g) => ({ category: "authz" as const, severity: SEV.authz, where: `${g.method} ${g.endpoint} → ${g.handler}`, detail: `unguarded write to ${g.sensitiveTables.join(", ")}` })),
    ...ex.map((p) => ({ category: "exfil" as const, severity: SEV.exfil, where: `${p.method} ${p.endpoint} → ${p.handler}`, detail: `reads ${p.sensitiveTables.join(", ")} with no redaction` })),
  ];
  const counts = { authz: az.length, exfil: ex.length, injection: inj.length };
  const { posture, verdict } = scorePosture(counts);
  return { verdict, posture, findings, counts };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
export interface SecurityAuditGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function securityAuditGauntlet(): SecurityAuditGauntlet {
  const cleanScore = scorePosture({ authz: 0, exfil: 0, injection: 0 });
  const cleanOK = cleanScore.posture === 100 && cleanScore.verdict === "CLEAR";
  const injScore = scorePosture({ injection: 1 });
  const injOK = injScore.verdict === "AT-RISK" && injScore.posture < 100 && injScore.posture >= 0;
  const exfilOnly = scorePosture({ exfil: 2 });
  const exfilOK = exfilOnly.verdict === "REVIEW" && exfilOnly.posture < 100;
  const floored = scorePosture({ injection: 10 }).posture === 0;   // never negative
  // smoke: a repo with an injection + an exfil → AT-RISK, both surfaced
  const files = [{ path: "api.ts", content:
    "router.get(\"/search\", search);\nexport function search(req){ return db.query(\"SELECT \" + req.query.q); }\n" +
    "router.get(\"/me\", getMe);\nexport function getMe(){ return prisma.credentials.findMany(); }\n" }];
  const g = buildCrossLayerGraph([{ path: "schema.prisma", content: "model Credentials { id Int @id }" }, ...files]);
  const audit = securityAudit(g, files);
  const composes = audit.verdict === "AT-RISK" && audit.findings.some((f) => f.category === "injection") && audit.findings.some((f) => f.category === "exfil");
  const total = (() => { try { scorePosture(null as never); securityAudit(null as never, null as never); securityAudit(buildCrossLayerGraph([]), []); return true; } catch { return false; } })();
  const checks = [
    { name: "CLEAN-100", pass: cleanOK, detail: "no findings → posture 100, verdict CLEAR" },
    { name: "INJECTION→AT-RISK", pass: injOK, detail: "an injection (or authz) finding → AT-RISK, posture drops" },
    { name: "EXFIL→REVIEW", pass: exfilOK, detail: "exfil-only → REVIEW (high, not critical)" },
    { name: "POSTURE-FLOOR", pass: floored, detail: "posture never goes below 0" },
    { name: "COMPOSES-TRIAD", pass: composes, detail: "securityAudit runs all three axes; a repo with injection + exfil → AT-RISK with both findings" },
    { name: "TOTAL", pass: total, detail: "null/empty never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
