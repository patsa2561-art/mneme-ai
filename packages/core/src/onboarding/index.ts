/**
 * ONBOARDING PATH — the deterministic reading order for a codebase, by real data-flow.
 *
 * A new developer (or an agent landing in an unfamiliar repo) reads files at random and takes hours to
 * grasp the architecture. The fastest way in is to follow the FLOWS: each API endpoint is an entry
 * point — read its handler, then the functions it calls, and see which tables and business rules that
 * touches. This derives exactly that from the cross-layer graph: per entry point, the ordered call
 * chain + the data it reaches + the rules it implements — the guided tour, deterministically.
 *
 * ★HONEST (DIAKRISIS): a reading order derived from the graph's entry points + call chains
 * (deterministic) — a guide that orients you fast, not the only way to read the code; the step order is
 * a breadth-first walk of the call graph, capped, so a huge flow is summarised, not exhaustively listed.
 */
import { type CrossLayerGraph, type GNode } from "../cross_layer_graph/index.js";

const SENSITIVE_RE = /\b(account|payment|wallet|password|credential|secret|token|admin|role|permission|balance|transaction|billing|card|user|order|invoice|subscription)\b/i;

export interface Flow { entry: string; method: string; file?: string; steps: string[]; tables: string[]; rules: string[]; sensitive: boolean }
export interface OnboardingPath { flows: Flow[]; entryCount: number; note: string }
/** Per entry point (endpoint), the ordered call chain + the tables/rules it reaches. */
export function onboardingPath(graph: CrossLayerGraph, opts?: { maxSteps?: number; maxDepth?: number }): OnboardingPath {
  const nodes = graph?.nodes ?? []; const edges = graph?.edges ?? []; const byId = new Map(nodes.map((n) => [n.id, n]));
  const maxSteps = opts?.maxSteps ?? 18, maxDepth = opts?.maxDepth ?? 5;
  // adjacency
  const calls = new Map<string, string[]>(); const writes = new Map<string, string[]>(); const reads = new Map<string, string[]>(); const implementedBy = new Map<string, string[]>();
  for (const e of edges) {
    if (e.relation === "CALLS") (calls.get(e.source) ?? calls.set(e.source, []).get(e.source))!.push(e.target);
    else if (e.relation === "WRITES_TO") (writes.get(e.source) ?? writes.set(e.source, []).get(e.source))!.push(e.target);
    else if (e.relation === "READS") (reads.get(e.source) ?? reads.set(e.source, []).get(e.source))!.push(e.target);
    else if (e.relation === "IMPLEMENTS") (implementedBy.get(e.target) ?? implementedBy.set(e.target, []).get(e.target))!.push(e.source);
  }
  const handlers = new Map<string, string[]>();   // endpointId → [handlerFnId]
  for (const e of edges) if (e.relation === "HANDLED_BY") (handlers.get(e.source) ?? handlers.set(e.source, []).get(e.source))!.push(e.target);

  const flows: Flow[] = [];
  const endpoints = nodes.filter((n) => n.type === "api_endpoint");
  for (const ep of endpoints) {
    const hIds = handlers.get(ep.id) ?? []; if (!hIds.length) continue;   // need a resolved handler to walk
    const steps: string[] = []; const stepIds = new Set<string>(); const tableIds = new Set<string>(); const ruleIds = new Set<string>();
    let frontier = [...hIds]; let depth = 0;
    while (frontier.length && depth < maxDepth && steps.length < maxSteps) {
      const next: string[] = [];
      for (const id of frontier) {
        if (!stepIds.has(id)) { stepIds.add(id); const n = byId.get(id); if (n && steps.length < maxSteps) steps.push(n.name); }
        for (const t of writes.get(id) ?? []) tableIds.add(t);
        for (const t of reads.get(id) ?? []) tableIds.add(t);
        for (const r of implementedBy.get(id) ?? []) ruleIds.add(r);
        for (const c of calls.get(id) ?? []) if (!stepIds.has(c)) next.push(c);
      }
      frontier = next; depth++;
    }
    const tables = [...tableIds].map((id) => byId.get(id)?.name).filter((x): x is string => !!x).sort();
    const rules = [...ruleIds].map((id) => byId.get(id)?.name).filter((x): x is string => !!x).sort();
    flows.push({ entry: ep.name, method: ep.method ?? "", file: byId.get(hIds[0])?.file, steps, tables, rules, sensitive: tables.some((t) => SENSITIVE_RE.test(t)) });
  }
  // order: sensitive flows first (most important to understand), then by data breadth, then by path
  flows.sort((a, b) => (b.sensitive ? 1 : 0) - (a.sensitive ? 1 : 0) || b.tables.length - a.tables.length || a.entry.localeCompare(b.entry));
  const note = flows.length ? "read these flows top-to-bottom — each is an entry point + the code it runs + the data it touches" : "no resolvable entry-point flows (the endpoints may use inline handlers the call graph can't follow)";
  return { flows, entryCount: endpoints.length, note };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
import { buildCrossLayerGraph } from "../cross_layer_graph/index.js";
export interface OnboardingGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function onboardingGauntlet(): OnboardingGauntlet {
  const g = buildCrossLayerGraph([
    { path: "schema.prisma", content: "model User { id Int @id }\nmodel Wallet { id Int @id }\nmodel Log { id Int @id }" },
    { path: "routes.ts", content: "router.post(\"/register\", registerHandler);\nrouter.get(\"/log\", logHandler);" },
    { path: "h.ts", content: "// feature: signup bonus\nexport function registerHandler(req,res){ prisma.user.create({data:{}}); return createWallet(); }\nexport function createWallet(){ return prisma.wallet.create({data:{}}); }\nexport function logHandler(){ return prisma.log.findMany(); }" },
    { path: "PRD.md", content: "## Feature: signup bonus" },
  ]);
  const p = onboardingPath(g);
  const register = p.flows.find((f) => f.entry === "/register");
  const reg = !!register && register.steps.includes("registerHandler") && register.steps.includes("createWallet") && register.tables.includes("User") && register.tables.includes("Wallet");
  const sensitiveFirst = p.flows[0]?.entry === "/register";       // /register touches User+Wallet (sensitive) → ordered first
  const rulesOK = !!register && register.rules.includes("signup bonus");
  const total = (() => { try { onboardingPath(null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "FLOW-CALL-CHAIN", pass: reg, detail: "an endpoint's flow = its handler → the functions it calls → the tables they touch, in order" },
    { name: "SENSITIVE-FIRST", pass: sensitiveFirst, detail: "flows touching sensitive data are ordered first (read the important paths first)" },
    { name: "RULES-IN-FLOW", pass: rulesOK, detail: "the business rule a flow's code implements is surfaced" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
