/**
 * ARCHITECTURAL DEAD-PATH DETECTOR — data-flow smells the compiler can't see.
 *
 * Line-level dead-code tools find an unused variable. This finds dead-code at the ARCHITECTURE level,
 * across the cross-layer graph:
 *   • WRITE-ONLY table — something writes it, nothing ever reads it. Data goes in and never comes out:
 *     a dead write, a reader that was deleted, or an audit/outbox table (worth a glance either way).
 *   • READ-ONLY table — read but never written by this codebase: external/seed data, or a missing writer.
 *   • ENDPOINT-UNREACHABLE function — no path from ANY detected API endpoint reaches it (endpoint
 *     —HANDLED_BY→ fn —CALLS→ fn …). A candidate for dead code — honestly, it may instead be a non-HTTP
 *     entrypoint (CLI / cron / job / event handler / library export), so it's a thing to CHECK, not a verdict.
 *
 * Deterministic from the graph's edges — no LLM. An AI agent uses it to avoid adding a write nobody
 * reads, and to find genuinely removable code.
 *
 * ★HONEST (DIAKRISIS): write-only / read-only reflect a table's incoming WRITES_TO / READS edges. One
 * caveat to verify: the graph emits ONE relation per (function, table) pair, so a table both read AND
 * written entirely inside a SINGLE function registers only as written — it can show as write-only when a
 * separate reader simply doesn't exist. Treat write-only/read-only as a high-signal smell to glance at,
 * not a verdict. Endpoint-unreachability is only computed when the repo HAS detected endpoints (else
 * everything is trivially "unreachable" and we report none); and "unreachable from an endpoint" is a
 * candidate, NOT proven dead — a non-HTTP entrypoint (CLI / cron / event / library export) legitimately
 * has no endpoint path.
 */
import { type CrossLayerGraph } from "../cross_layer_graph/index.js";

export interface DeadNode { name: string; file?: string }
export interface DeadPaths { writeOnlyTables: DeadNode[]; readOnlyTables: DeadNode[]; endpointUnreachableFunctions: DeadNode[]; hasEndpoints: boolean; clean: boolean }

export function deadPaths(graph: CrossLayerGraph): DeadPaths {
  const nodes = graph?.nodes ?? []; const edges = graph?.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const tables = nodes.filter((n) => n.type === "db_table");
  const fns = nodes.filter((n) => n.type === "function");

  const written = new Set<string>(), read = new Set<string>();
  for (const e of edges) { if (e.relation === "WRITES_TO") written.add(e.target); else if (e.relation === "READS") read.add(e.target); }
  const writeOnlyTables: DeadNode[] = []; const readOnlyTables: DeadNode[] = [];
  for (const t of tables) {
    const w = written.has(t.id), r = read.has(t.id);
    if (w && !r) writeOnlyTables.push({ name: t.name, file: t.file });
    else if (r && !w) readOnlyTables.push({ name: t.name, file: t.file });
  }

  // endpoint-reachability: start from every function HANDLED_BY an endpoint, follow CALLS forward.
  const handledFns = new Set<string>(); const callees = new Map<string, string[]>(); let endpointCount = 0;
  const endpoints = new Set<string>();
  for (const e of edges) {
    if (e.relation === "HANDLED_BY") { handledFns.add(e.target); endpoints.add(e.source); }
    else if (e.relation === "CALLS") (callees.get(e.source) ?? callees.set(e.source, []).get(e.source))!.push(e.target);
  }
  endpointCount = endpoints.size;
  const endpointUnreachableFunctions: DeadNode[] = [];
  if (endpointCount > 0) {
    const reachable = new Set<string>(handledFns); const stack = [...handledFns];
    while (stack.length) { const id = stack.pop()!; for (const c of (callees.get(id) ?? [])) if (!reachable.has(c)) { reachable.add(c); stack.push(c); } }
    for (const fn of fns) if (!reachable.has(fn.id)) endpointUnreachableFunctions.push({ name: fn.name, file: fn.file });
  }

  void byId;
  return { writeOnlyTables, readOnlyTables, endpointUnreachableFunctions, hasEndpoints: endpointCount > 0, clean: !writeOnlyTables.length && !readOnlyTables.length && !endpointUnreachableFunctions.length };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
export interface DeadPathGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function deadPathGauntlet(): DeadPathGauntlet {
  const g = buildCrossLayerGraph([
    { path: "schema.prisma", content: "model Audit { id Int @id }\nmodel Seed { id Int @id }\nmodel Live { id Int @id }" },
    { path: "api.ts", content:
      "router.get(\"/x\", handler);\n" +
      "export function handler(){ return helper(); }\n" +              // endpoint handler → reachable
      "export function helper(){ return prisma.seed.findMany(); }\n" + // reachable; READS Seed (read-only)
      "export function logAudit(){ return prisma.audit.create({data:{}}); }\n" +  // NOT called/handled → unreachable; WRITES Audit (write-only)
      "export function liveWrite(){ return prisma.live.create({data:{}}); }\n" +  // WRITES Live
      "export function liveRead(){ return prisma.live.findMany(); }\n" },          // READS Live → Live is read+written, NOT flagged
  ]);
  const d = deadPaths(g);
  const writeOnly = d.writeOnlyTables.some((t) => /audit/i.test(t.name)) && !d.writeOnlyTables.some((t) => /live/i.test(t.name));
  const readOnly = d.readOnlyTables.some((t) => /seed/i.test(t.name)) && !d.readOnlyTables.some((t) => /live/i.test(t.name));
  const unreachable = d.endpointUnreachableFunctions.some((f) => /logAudit/i.test(f.name)) && !d.endpointUnreachableFunctions.some((f) => /helper|handler/i.test(f.name));
  // no endpoints → unreachability not computed (everything would be trivially unreachable).
  const noEndpointGuard = (() => { const g2 = buildCrossLayerGraph([{ path: "x.ts", content: "export function a(){ return 1; }" }]); const d2 = deadPaths(g2); return d2.hasEndpoints === false && d2.endpointUnreachableFunctions.length === 0; })();
  const total = (() => { try { deadPaths(null as never); deadPaths(buildCrossLayerGraph([])); return true; } catch { return false; } })();
  const checks = [
    { name: "WRITE-ONLY", pass: writeOnly, detail: "a table written but never read is flagged write-only; a read+written table is not" },
    { name: "READ-ONLY", pass: readOnly, detail: "a table read but never written is flagged read-only" },
    { name: "ENDPOINT-UNREACHABLE", pass: unreachable, detail: "a function reachable from no endpoint is flagged; handlers + their callees are not" },
    { name: "NO-ENDPOINT-GUARD", pass: noEndpointGuard, detail: "with no detected endpoints, unreachability is NOT computed (avoids trivial false positives)" },
    { name: "TOTAL", pass: total, detail: "null/empty never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
