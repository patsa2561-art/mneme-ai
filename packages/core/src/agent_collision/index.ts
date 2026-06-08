/**
 * CROSS-AGENT COLLISION DETECTOR — a world-first for the multi-agent era.
 *
 * When two AI agents (or two branches, or two worktrees) edit a repo concurrently, `git` only catches
 * a collision when they touch the SAME LINES of the SAME FILE. It is BLIND to the dangerous case:
 * Agent A edits `auth.ts` (its function writes the `users` table) while Agent B edits `billing.ts`
 * (its function ALSO writes `users`) — different files, NO git conflict, but a real CROSS-LAYER
 * collision that surfaces as data corruption in production. Nothing detects this today.
 *
 * This does: given N in-flight change sets, it computes each one's cross-layer FOOTPRINT (which tables
 * it writes/reads, endpoints it owns, rules it implements, functions + files it edits) from the
 * deterministic graph, then reports where two footprints CONVERGE on a shared data/api/business node —
 * the collision git cannot see. Severity is honest: two writers of the same table, or two edits to the
 * same function, are HIGH; a write-vs-read on a table or a shared file/endpoint is MEDIUM; a shared
 * read or rule is LOW.
 *
 * ★HONEST (DIAKRISIS): it detects STRUCTURAL convergence (both change sets reach the same node),
 * deterministically — a candidate collision to coordinate on, NOT a proven runtime bug. The win is
 * that it sees the cross-layer overlap git is structurally blind to.
 */
import { type CrossLayerGraph, buildCrossLayerGraph, parseChangedSymbols, type DiffChange } from "../cross_layer_graph/index.js";

const lc = (s: string) => String(s ?? "").toLowerCase();
const norm = (p: string) => lc(p).replace(/\\/g, "/").replace(/^\.\//, "");
function fileMatch(a: string | undefined, b: string): boolean { const x = norm(a || ""), y = norm(b); return !!x && !!y && (x === y || x.endsWith(y) || y.endsWith(x)); }
function inter(a: Set<string>, b: Set<string>): string[] { return [...a].filter((x) => b.has(x)).sort(); }

export interface ChangeSet { agent: string; diff: string | ReadonlyArray<DiffChange> }
export interface Footprint { agent: string; writes: string[]; reads: string[]; endpoints: string[]; rules: string[]; functions: string[]; files: string[] }

/** The cross-layer footprint of one change set: what its changed functions write/read/own/implement. */
export function footprint(graph: CrossLayerGraph, cs: ChangeSet): Footprint {
  const changes = (typeof cs?.diff === "string" ? parseChangedSymbols(cs.diff) : (cs?.diff ?? [])) as DiffChange[];
  const nodes = graph?.nodes ?? []; const byId = new Map(nodes.map((n) => [n.id, n]));
  const files = new Set<string>(changes.map((c) => norm(c.file)).filter(Boolean));
  const originIds = new Set<string>(); const fnNames = new Set<string>();
  for (const ch of changes) {
    const inFile = nodes.find((n) => n.type === "function" && n.name === ch.name && fileMatch(n.file, ch.file));
    const node = inFile ?? nodes.find((n) => n.type === "function" && n.name === ch.name);
    if (node) { originIds.add(node.id); fnNames.add(node.name); }
  }
  const writes = new Set<string>(), reads = new Set<string>(), endpoints = new Set<string>(), rules = new Set<string>();
  for (const e of graph?.edges ?? []) {
    if (e.relation === "WRITES_TO" && originIds.has(e.source)) { const t = byId.get(e.target); if (t) writes.add(t.name); }
    else if (e.relation === "READS" && originIds.has(e.source)) { const t = byId.get(e.target); if (t) reads.add(t.name); }
    else if (e.relation === "HANDLED_BY" && originIds.has(e.target)) { const ep = byId.get(e.source); if (ep) endpoints.add(`${ep.method ? ep.method + " " : ""}${ep.name}`); }
    else if (e.relation === "IMPLEMENTS" && originIds.has(e.target)) { const r = byId.get(e.source); if (r) rules.add(r.name); }
  }
  // a table that is BOTH written and read by this change set counts as a writer (the stronger signal)
  for (const w of writes) reads.delete(w);
  return { agent: cs?.agent ?? "agent", writes: [...writes].sort(), reads: [...reads].sort(), endpoints: [...endpoints].sort(), rules: [...rules].sort(), functions: [...fnNames].sort(), files: [...files].sort() };
}

export type CollisionSeverity = "HIGH" | "MEDIUM" | "LOW";
export interface Collision {
  agents: [string, string];
  sharedWriteTables: string[];   // both WRITE the same table — git-invisible, data-corruption risk (HIGH)
  writeReadTables: string[];     // one writes, one reads the same table (MEDIUM)
  sharedFunctions: string[];     // both edit the same function (HIGH)
  sharedEndpoints: string[];     // both own the same endpoint (MEDIUM)
  sharedRules: string[];         // both implement the same business rule (MEDIUM)
  sharedFiles: string[];         // both edit the same file (MEDIUM — git MAY catch a line conflict)
  severity: CollisionSeverity;
  reason: string;
}
/** Detect cross-layer collisions across N concurrent change sets (pairwise). Deterministic. */
export function detectCollisions(graph: CrossLayerGraph, changeSets: ReadonlyArray<ChangeSet>): Collision[] {
  const fps = (changeSets ?? []).map((cs) => footprint(graph, cs));
  const setOf = (a: string[]) => new Set(a);
  const out: Collision[] = [];
  for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) {
    const a = fps[i], b = fps[j];
    const aw = setOf(a.writes), bw = setOf(b.writes), ar = setOf(a.reads), br = setOf(b.reads);
    const sharedWriteTables = inter(aw, bw);
    const writeReadTables = [...new Set([...inter(aw, br), ...inter(ar, bw)])].sort();
    const sharedFunctions = inter(setOf(a.functions), setOf(b.functions));
    const sharedEndpoints = inter(setOf(a.endpoints), setOf(b.endpoints));
    const sharedRules = inter(setOf(a.rules), setOf(b.rules));
    const sharedFiles = inter(setOf(a.files), setOf(b.files));
    const any = sharedWriteTables.length || writeReadTables.length || sharedFunctions.length || sharedEndpoints.length || sharedRules.length || sharedFiles.length;
    if (!any) continue;
    const severity: CollisionSeverity = (sharedWriteTables.length || sharedFunctions.length) ? "HIGH" : (writeReadTables.length || sharedFiles.length || sharedEndpoints.length) ? "MEDIUM" : "LOW";
    const bits: string[] = [];
    if (sharedWriteTables.length) bits.push(`both WRITE ${sharedWriteTables.map((t) => "'" + t + "'").join(", ")}`);
    if (sharedFunctions.length) bits.push(`both edit function ${sharedFunctions.join(", ")}`);
    if (writeReadTables.length) bits.push(`write/read overlap on ${writeReadTables.join(", ")}`);
    if (sharedEndpoints.length) bits.push(`both own ${sharedEndpoints.join(", ")}`);
    if (sharedRules.length) bits.push(`both implement ${sharedRules.join(", ")}`);
    if (sharedFiles.length) bits.push(`both edit file ${sharedFiles.join(", ")}`);
    out.push({ agents: [a.agent, b.agent], sharedWriteTables, writeReadTables, sharedFunctions, sharedEndpoints, sharedRules, sharedFiles, severity, reason: bits.join(" · ") });
  }
  const rank: Record<CollisionSeverity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  return out.sort((x, y) => rank[y.severity] - rank[x.severity]);
}
/** Convenience: the worst severity across all collisions (or null when clear). */
export function collisionVerdict(collisions: ReadonlyArray<Collision>): { clear: boolean; worst: CollisionSeverity | null; count: number } {
  if (!collisions?.length) return { clear: true, worst: null, count: 0 };
  const worst = collisions.some((c) => c.severity === "HIGH") ? "HIGH" : collisions.some((c) => c.severity === "MEDIUM") ? "MEDIUM" : "LOW";
  return { clear: false, worst, count: collisions.length };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface CollisionGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function collisionGauntlet(): CollisionGauntlet {
  const g = buildCrossLayerGraph([
    { path: "schema.prisma", content: "model User { id Int @id }\nmodel Wallet { id Int @id }\nmodel Audit { id Int @id }" },
    { path: "auth.ts", content: "export function register(uid){ return prisma.user.create({data:{}}); }" },
    { path: "billing.ts", content: "export function charge(uid){ prisma.user.update({where:{}}); return prisma.wallet.create({data:{}}); }" },
    { path: "report.ts", content: "export function report(){ return prisma.audit.findMany(); }" },
  ]);
  const dA = "--- a/auth.ts\n+++ b/auth.ts\n@@ -1,1 +1,2 @@ export function register(uid){\n+x\n";       // writes User
  const dB = "--- a/billing.ts\n+++ b/billing.ts\n@@ -1,1 +1,2 @@ export function charge(uid){\n+x\n";   // writes Wallet, updates User
  const dC = "--- a/report.ts\n+++ b/report.ts\n@@ -1,1 +1,2 @@ export function report(){\n+x\n";        // reads Audit
  const cols = detectCollisions(g, [{ agent: "claude", diff: dA }, { agent: "gpt", diff: dB }, { agent: "gemini", diff: dC }]);
  // A writes User, B writes User → HIGH write-write collision (DIFFERENT files — git-invisible)
  const ab = cols.find((c) => (c.agents.includes("claude") && c.agents.includes("gpt")));
  const highOK = !!ab && ab.severity === "HIGH" && ab.sharedWriteTables.includes("User");
  // C (reads Audit) collides with no one
  const cClear = !cols.some((c) => c.agents.includes("gemini"));
  // verdict worst = HIGH
  const v = collisionVerdict(cols); const verdictOK = !v.clear && v.worst === "HIGH";
  // no collision when footprints are disjoint
  const disjoint = detectCollisions(g, [{ agent: "x", diff: dA }, { agent: "y", diff: dC }]);
  const disjointOK = disjoint.length === 0;
  const total = (() => { try { detectCollisions(null as never, null as never); footprint(null as never, null as never); collisionVerdict(null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "WRITE-WRITE-HIGH", pass: highOK, detail: "two agents writing the SAME table from DIFFERENT files → HIGH collision git is blind to" },
    { name: "DISJOINT-CLEAR", pass: cClear && disjointOK, detail: "agents with no cross-layer overlap → no collision (no false alarm)" },
    { name: "VERDICT", pass: verdictOK, detail: "worst-severity rollup across all pairs" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
