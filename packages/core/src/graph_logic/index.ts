/**
 * PROVABLE CROSS-LAYER REASONING — the move that turns every heuristic finding into a PROOF.
 *
 * The whole suite's honest weakness is the same line repeated everywhere: "a candidate to verify, not a
 * proof." This fuses the two halves Mneme already owns — the deterministic cross-layer GRAPH (the facts)
 * and the sound LOGIC ENGINE (the reasoner) — so a question like "is it safe to drop the `users` table?"
 * is not answered by a heuristic verdict but DERIVED: real facts are extracted from the graph
 * (writes/reads/serves), grounded rules are generated, and the logic engine PROVES `unsafe_to_drop(users)`
 * with a proof tree back to the exact reader/writer/endpoint — or returns UNKNOWN (no structural blocker)
 * rather than guessing "safe". A finding you can replay as a proof, not a number you must trust.
 *
 * ★HONEST (DIAKRISIS): the facts are as good as the deterministic extractor (structural, no dynamic/
 * reflective access) and the reasoning is sound monotone logic — so a PROVEN-unsafe is backed by a real
 * cited blocker, while "no blocker found" is reported as UNKNOWN/likely-safe (prove-or-unknown), never a
 * false "safe". The leap is qualitative: the verdict now carries a checkable proof, not just a label.
 */
import { type CrossLayerGraph, type GNode } from "../cross_layer_graph/index.js";
import { prove, type Rule, type ProofStep } from "../logic_engine/index.js";

const atom = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** All cross-layer relations as ground logic atoms: writes/reads(fn,table), serves(endpoint,fn), calls(a,b). */
export function factsFromGraph(graph: CrossLayerGraph): string[] {
  const nodes = graph?.nodes ?? []; const edges = graph?.edges ?? []; const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const nm = (id: string) => byId.get(id)?.name ?? "";
  const out = new Set<string>();
  for (const e of edges) {
    const s = atom(nm(e.source)), t = atom(nm(e.target)); if (!s || !t) continue;
    if (e.relation === "WRITES_TO") out.add(`writes(${s},${t})`);
    else if (e.relation === "READS") out.add(`reads(${s},${t})`);
    else if (e.relation === "HANDLED_BY") out.add(`serves(${s},${t})`);   // endpoint serves fn
    else if (e.relation === "CALLS") out.add(`calls(${s},${t})`);
  }
  return [...out].sort();
}

export type DropVerdict = "UNSAFE" | "LIKELY_SAFE" | "UNKNOWN";
export interface DropProof { table: string | null; verdict: DropVerdict; blockers: Array<{ kind: "reader" | "writer" | "endpoint"; name: string }>; chain: ProofStep[]; reason: string }
/** Prove `unsafe_to_drop(T)` from the graph: PROVEN→UNSAFE (with the blocking reader/writer/endpoint),
 *  else LIKELY_SAFE (no structural blocker — prove-or-unknown, verify dynamic access). */
export function dropProof(graph: CrossLayerGraph, tableName: string): DropProof {
  const nodes = graph?.nodes ?? []; const edges = graph?.edges ?? []; const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const table = nodes.find((n) => n.type === "db_table" && atom(n.name) === atom(tableName)) ?? nodes.find((n) => n.type === "db_table" && atom(n.name).includes(atom(tableName)));
  if (!table) return { table: null, verdict: "UNKNOWN", blockers: [], chain: [], reason: `no table matching "${tableName}"` };
  const T = atom(table.name);
  const nm = (id: string) => byId.get(id)?.name ?? "";
  const readers = new Set<string>(), writers = new Set<string>(), toucherIds = new Set<string>();
  for (const e of edges) {
    if (e.target !== table.id) continue;
    if (e.relation === "READS") { readers.add(atom(nm(e.source))); toucherIds.add(e.source); }
    else if (e.relation === "WRITES_TO") { writers.add(atom(nm(e.source))); toucherIds.add(e.source); }
  }
  // endpoints that serve a toucher directly (the live-route blocker)
  const endpoints = new Set<string>();
  for (const e of edges) if (e.relation === "HANDLED_BY" && toucherIds.has(e.target)) endpoints.add(atom(nm(e.source)));
  const facts: string[] = []; const rules: Rule[] = []; const goal = `unsafe_to_drop(${T})`;
  for (const r of readers) { facts.push(`reads(${r},${T})`); rules.push({ id: `reader ${r} reads ${T}`, when: [`reads(${r},${T})`], then: goal }); }
  for (const w of writers) { facts.push(`writes(${w},${T})`); rules.push({ id: `writer ${w} writes ${T}`, when: [`writes(${w},${T})`], then: goal }); }
  for (const ep of endpoints) { facts.push(`serves(${ep},${T})`); rules.push({ id: `endpoint ${ep} serves a toucher of ${T}`, when: [`serves(${ep},${T})`], then: goal }); }
  const p = prove(facts, rules, goal);
  const blockers = [
    ...[...readers].map((n) => ({ kind: "reader" as const, name: n })),
    ...[...writers].map((n) => ({ kind: "writer" as const, name: n })),
    ...[...endpoints].map((n) => ({ kind: "endpoint" as const, name: n })),
  ];
  if (p.status === "PROVEN") return { table: table.name, verdict: "UNSAFE", blockers, chain: p.chain, reason: `PROVEN unsafe to drop '${table.name}' — ${readers.size} reader(s), ${writers.size} writer(s), ${endpoints.size} endpoint(s) depend on it (see proof)` };
  return { table: table.name, verdict: "LIKELY_SAFE", blockers, chain: [], reason: `no structural reader/writer/endpoint for '${table.name}' in the scanned code — likely safe (UNKNOWN per prove-or-unknown; verify dynamic/reflective access)` };
}

export interface ReachProof { from: string; to: string; reachable: boolean; chain: ProofStep[]; reason: string }
/** Prove `reaches(endpoint, table)`: endpoint serves a fn that (transitively) calls a fn touching the table. */
export function reachesProof(graph: CrossLayerGraph, endpointName: string, tableName: string): ReachProof {
  const nodes = graph?.nodes ?? []; const edges = graph?.edges ?? []; const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const nm = (id: string) => byId.get(id)?.name ?? "";
  const ep = nodes.find((n) => n.type === "api_endpoint" && (atom(n.name).includes(atom(endpointName)) || atom(`${n.method} ${n.name}`).includes(atom(endpointName))));
  const table = nodes.find((n) => n.type === "db_table" && atom(n.name) === atom(tableName));
  const E = atom(ep ? `${ep.method ?? ""} ${ep.name}` : endpointName), T = atom(table ? table.name : tableName);
  if (!ep || !table) return { from: E, to: T, reachable: false, chain: [], reason: "endpoint or table not found" };
  const facts: string[] = []; const rules: Rule[] = []; const goal = `reaches(${E},${T})`;
  // ground: serves(E,F) ∧ touches(F,T) => reaches ; calls(F,G) ∧ touches(G,T) => touches(F,T) ; writes/reads(F,T) => touches(F,T)
  for (const e of edges) {
    const s = atom(nm(e.source)), t = atom(nm(e.target));
    if (e.relation === "WRITES_TO" || e.relation === "READS") { if (e.target === table.id) { facts.push(`touches(${s},${T})`); } }
    if (e.relation === "CALLS") { rules.push({ id: `${s} calls ${t}`, when: [`calls(${s},${t})`, `touches(${t},${T})`], then: `touches(${s},${T})` }); facts.push(`calls(${s},${t})`); }
    if (e.relation === "HANDLED_BY" && e.source === ep.id) { const f = atom(nm(e.target)); facts.push(`serves(${E},${f})`); rules.push({ id: `${E} serves ${f}`, when: [`serves(${E},${f})`, `touches(${f},${T})`], then: goal }); }
  }
  const p = prove(facts, rules, goal);
  return { from: E, to: T, reachable: p.status === "PROVEN", chain: p.chain, reason: p.status === "PROVEN" ? `PROVEN: ${ep.method ?? ""} ${ep.name} reaches table '${table.name}' (proof chain via the call graph)` : `no proven path from ${ep.method ?? ""} ${ep.name} to '${table.name}' in the scanned code (UNKNOWN)` };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
export interface GraphLogicGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function graphLogicGauntlet(): GraphLogicGauntlet {
  const g = buildCrossLayerGraph([
    { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Orphan { id Int @id }" },
    { path: "routes.ts", content: "router.get(\"/balance\", getBalance);" },
    { path: "svc.ts", content: "export function getBalance(){ return readWallet(); }\nexport function readWallet(){ return prisma.wallet.findMany(); }" },
  ]);
  const facts = factsFromGraph(g);
  const factsOK = facts.some((f) => /reads\(readwallet,wallet\)/.test(f)) && facts.some((f) => /calls\(getbalance,readwallet\)/.test(f)) && facts.some((f) => /serves\(/.test(f));
  const dp = dropProof(g, "Wallet");
  const dropUnsafeOK = dp.verdict === "UNSAFE" && dp.blockers.some((b) => b.kind === "reader" && b.name === "readwallet") && dp.chain.some((s) => s.atom === "unsafe_to_drop(wallet)");
  const orphan = dropProof(g, "Orphan");
  const dropSafeOK = orphan.verdict === "LIKELY_SAFE" && orphan.blockers.length === 0;     // nothing touches Orphan → prove-or-unknown
  const rp = reachesProof(g, "/balance", "Wallet");
  const reachOK = rp.reachable === true && rp.chain.some((s) => s.atom.startsWith("touches(") || s.atom.startsWith("reaches("));
  const total = (() => { try { factsFromGraph(null as never); dropProof(null as never, "x"); reachesProof(null as never, "a", "b"); return true; } catch { return false; } })();
  const checks = [
    { name: "FACTS-FROM-GRAPH", pass: factsOK, detail: "the cross-layer graph becomes ground logic atoms: reads/writes(fn,table) · calls(a,b) · serves(endpoint,fn)" },
    { name: "PROVEN-UNSAFE-DROP", pass: dropUnsafeOK, detail: "drop a table a function reads → PROVEN unsafe, with the proof chain back to the exact reader (not a heuristic verdict)" },
    { name: "UNKNOWN-NOT-FALSE-SAFE", pass: dropSafeOK, detail: "a table nothing touches → LIKELY_SAFE (no structural blocker — prove-or-unknown, never a false 'safe')" },
    { name: "PROVEN-REACHES", pass: reachOK, detail: "an endpoint reaching a table THROUGH the call graph → PROVEN, with the transitive proof" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
