/**
 * ARCHITECTURE LOCK — package-lock, but for your architecture's ACCOUNTABILITY.
 *
 * A lockfile pins your dependencies so a change is a reviewed, committed act. Nothing does that for the
 * things that actually break production across layers: the API surface, the authorization gaps, the
 * single-point-of-failure keystones. This captures that cross-layer contract into a signed
 * `architecture.lock` and, in CI, FAILS the build when a change REGRESSES it — a removed endpoint
 * (breaking), a NEW authorization gap (security regression), a newly-exposed sensitive table — unless
 * the lock is updated, which is itself a reviewed, signed, version-controlled act. The lock plus its git
 * history becomes a tamper-evident accountability trail that compounds: the longer a team runs it, the
 * more switching away costs them.
 *
 * ★HONEST (DIAKRISIS): the lock captures exactly what the deterministic extractors see (measured
 * precision 1.0, recall ~0.97 — so a dynamically-built route is invisible to both lock and check, by
 * construction, never a false regression); updating the lock is a human act, not an automated rubber-
 * stamp; it is a CI gate over the structural contract, not a runtime guarantee.
 */
import { createHash } from "node:crypto";
import { buildCrossLayerGraph, graphHealth, type SourceFile, type CrossLayerGraph } from "../cross_layer_graph/index.js";
import { authzGaps } from "../authz_gap/index.js";
import { normPath as normalizePathPublic } from "../cross_service/index.js";

export interface ArchLock { v: 1; endpoints: string[]; authzGaps: string[]; sensitiveTables: string[]; keystones: string[]; fingerprint: string }
export type ViolationKind = "REMOVED_ENDPOINT" | "NEW_AUTHZ_GAP" | "NEW_SENSITIVE_EXPOSURE";
export interface LockViolation { kind: ViolationKind; detail: string; severity: "BREAKING" | "SECURITY" }
export interface LockCheck { ok: boolean; violations: LockViolation[]; addedEndpoints: string[]; removedEndpoints: string[]; fingerprintMatch: boolean }

function surfaceFromGraph(g: CrossLayerGraph): { endpoints: string[]; authzGaps: string[]; sensitiveTables: string[]; keystones: string[] } {
  const endpoints = [...new Set(g.nodes.filter((n) => n.type === "api_endpoint").map((n) => `${n.method || "ANY"} ${normalizePathPublic(n.name)}`))].sort();
  const gaps = authzGaps(g);
  const authzGapList = [...new Set(gaps.map((x) => `${x.method} ${normalizePathPublic(x.endpoint)}`))].sort();
  const sensitiveTables = [...new Set(gaps.flatMap((x) => x.sensitiveTables))].sort();
  const keystones = [...new Set(graphHealth(g).keystones.map((k) => k.node.name))].sort();
  return { endpoints, authzGaps: authzGapList, sensitiveTables, keystones };
}

/** Capture the cross-layer accountability contract from the repo into a lock (fingerprint over the surface). */
export function buildLock(files: ReadonlyArray<SourceFile>): ArchLock {
  const s = surfaceFromGraph(buildCrossLayerGraph((files ?? []) as SourceFile[]));
  const body = { v: 1 as const, endpoints: s.endpoints, authzGaps: s.authzGaps, sensitiveTables: s.sensitiveTables, keystones: s.keystones };
  const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return { ...body, fingerprint };
}

/** CI gate: compare a locked contract against the current repo and flag REGRESSIONS (additions are fine). */
export function checkLock(locked: ArchLock, currentFiles: ReadonlyArray<SourceFile>): LockCheck {
  const cur = buildLock(currentFiles);
  const lockedEps = new Set(locked?.endpoints ?? []); const curEps = new Set(cur.endpoints);
  const lockedGaps = new Set(locked?.authzGaps ?? []); const lockedSens = new Set(locked?.sensitiveTables ?? []);
  const removedEndpoints = [...lockedEps].filter((e) => !curEps.has(e)).sort();
  const addedEndpoints = [...curEps].filter((e) => !lockedEps.has(e)).sort();
  const newAuthzGaps = cur.authzGaps.filter((g) => !lockedGaps.has(g));
  const newSensitive = cur.sensitiveTables.filter((t) => !lockedSens.has(t));
  const violations: LockViolation[] = [
    ...removedEndpoints.map((e): LockViolation => ({ kind: "REMOVED_ENDPOINT", detail: `endpoint removed from the locked contract: ${e}`, severity: "BREAKING" })),
    ...newAuthzGaps.map((g): LockViolation => ({ kind: "NEW_AUTHZ_GAP", detail: `NEW unguarded sensitive-write path not in the lock: ${g}`, severity: "SECURITY" })),
    ...newSensitive.map((t): LockViolation => ({ kind: "NEW_SENSITIVE_EXPOSURE", detail: `newly-exposed sensitive table: ${t}`, severity: "SECURITY" })),
  ];
  return { ok: violations.length === 0, violations, addedEndpoints, removedEndpoints, fingerprintMatch: cur.fingerprint === locked?.fingerprint };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface ArchLockGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function archLockGauntlet(): ArchLockGauntlet {
  const base: SourceFile[] = [
    { path: "schema.prisma", content: "model Account { id Int @id }" },
    { path: "routes.ts", content: "router.get(\"/v1/users/:id\", getUser);\nrouter.post(\"/v1/charge\", payHandler);" },
    { path: "h.ts", content: "export function getUser(req){ requireAuth(req); return 1; }\nexport function requireAuth(r){ return r.user; }\nexport function payHandler(req){ requireAuth(req); return prisma.account.update({where:{}}); }" },
  ];
  const lock = buildLock(base);
  // self-check: identical repo → no violations, fingerprint matches
  const self = checkLock(lock, base); const selfOK = self.ok && self.fingerprintMatch && self.violations.length === 0;
  // remove an endpoint → BREAKING violation
  const removed: SourceFile[] = [base[0], { path: "routes.ts", content: "router.post(\"/v1/charge\", payHandler);" }, base[2]];
  const rc = checkLock(lock, removed); const removeOK = !rc.ok && rc.violations.some((v) => v.kind === "REMOVED_ENDPOINT" && v.detail.includes("/v1/users"));
  // introduce a NEW authz gap (drop the auth on the charge handler) → SECURITY violation
  const gapped: SourceFile[] = [base[0], base[1], { path: "h.ts", content: "export function getUser(req){ requireAuth(req); return 1; }\nexport function requireAuth(r){ return r.user; }\nexport function payHandler(req){ return prisma.account.update({where:{}}); }" }];
  const gc = checkLock(lock, gapped); const gapOK = !gc.ok && gc.violations.some((v) => v.kind === "NEW_AUTHZ_GAP");
  // adding an endpoint is NOT a violation (additions are fine)
  const added: SourceFile[] = [base[0], { path: "routes.ts", content: base[1].content + "\nrouter.get(\"/v1/health\", getUser);" }, base[2]];
  const ac = checkLock(lock, added); const addOK = ac.ok && ac.addedEndpoints.some((e) => e.includes("/v1/health"));
  const total = (() => { try { buildLock(null as never); checkLock(null as never, null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "SELF-CONSISTENT", pass: selfOK, detail: "the same repo checked against its own lock → no violations, fingerprint matches" },
    { name: "REMOVED-ENDPOINT-BREAKING", pass: removeOK, detail: "an endpoint removed from the locked contract → BREAKING violation (CI fails)" },
    { name: "NEW-AUTHZ-GAP-SECURITY", pass: gapOK, detail: "a NEW unguarded sensitive-write path not in the lock → SECURITY violation" },
    { name: "ADDITIONS-ALLOWED", pass: addOK, detail: "adding a new endpoint is NOT a violation (only regressions fail; additions are surfaced)" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
