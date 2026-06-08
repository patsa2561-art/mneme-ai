/**
 * RISK HOTSPOTS — fuse the whole cross-layer suite into ONE ranked answer: "what is the riskiest
 * thing in this codebase to be careful with?"
 *
 * A human or agent doesn't want six separate reports — they want the one ranked list that says "guard
 * THIS first." This composes the deterministic signals no other tool unifies: a KEYSTONE (sole writer
 * to a table = single point of failure) that is ALSO UNTESTED and ALSO writes a SENSITIVE table and is
 * reached by many callers is the scariest node in the repo — and an endpoint with an AUTHZ GAP (writes
 * a sensitive table with no auth on the path) is a security hotspot. One weighted score, one ranking.
 *
 * ★HONEST (DIAKRISIS): a transparent weighted composite of deterministic signals (each one already
 * gauntlet-tested) — a PRIORITIZATION of where to look, with every contributing factor shown, not a
 * proof of a bug. Reliable to the extent its inputs are (keystone = exact; untested = name-mention
 * heuristic; authz = a smell). The value is the fusion: the single list that ranks the danger.
 */
import { type SourceFile, type GNode, buildCrossLayerGraph, graphHealth } from "../cross_layer_graph/index.js";
import { buildCoverage } from "../test_gap/index.js";
import { authzGaps } from "../authz_gap/index.js";

const SENSITIVE_RE = /\b(account|payment|wallet|password|credential|secret|token|admin|role|permission|balance|transaction|billing|card|user|order|invoice|subscription)\b/i;

export type RiskBand = "CRITICAL" | "HIGH" | "MEDIUM";
export interface Hotspot { name: string; type: GNode["type"] | "endpoint"; file?: string; score: number; band: RiskBand; factors: string[] }
/** The ranked risk hotspots of a repo — keystones × untested × sensitive × authz, fused. */
export function riskHotspots(files: ReadonlyArray<SourceFile>, opts?: { top?: number }): Hotspot[] {
  const g = buildCrossLayerGraph(files as SourceFile[]);
  const health = graphHealth(g);
  const cov = buildCoverage(files);
  const gaps = authzGaps(g);
  const out: Hotspot[] = [];

  // keystone-rooted hotspots
  for (const k of health.keystones) {
    const factors: string[] = [`keystone — sole writer to ${k.soleWriterOf.map((t) => "'" + t + "'").join(", ")}`];
    let score = 3;
    const untested = !cov.covered(k.node); if (untested) { score += 3; factors.push("untested (no test mentions it)"); }
    const sensitive = k.soleWriterOf.some((t) => SENSITIVE_RE.test(t)); if (sensitive) { score += 2; factors.push("writes a SENSITIVE table"); }
    const fan = Math.min(3, k.fanIn + k.reachedByEndpoints); if (fan > 0) { score += fan; factors.push(`fan-in ${k.fanIn} caller(s) + ${k.reachedByEndpoints} endpoint(s)`); }
    out.push({ name: k.node.name, type: "function", file: k.node.file, score, band: "MEDIUM", factors });
  }
  // authz-gap endpoints are security hotspots
  for (const ag of gaps) {
    out.push({ name: `${ag.method} ${ag.endpoint}`, type: "endpoint", file: ag.handlerFile, score: 6 + ag.sensitiveTables.length, band: "MEDIUM", factors: [`AUTHZ GAP — writes ${ag.sensitiveTables.map((t) => "'" + t + "'").join(", ")} via ${ag.handler} with no auth on the path`] });
  }
  // merge an endpoint+keystone that are the same handler? keep separate (different lens). Rank + band.
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  for (const h of out) h.band = h.score >= 8 ? "CRITICAL" : h.score >= 5 ? "HIGH" : "MEDIUM";
  return typeof opts?.top === "number" ? out.slice(0, opts.top) : out;
}
export function riskSummary(hotspots: ReadonlyArray<Hotspot>): { total: number; critical: number; high: number; worst: Hotspot | null } {
  const list = hotspots ?? [];
  return { total: list.length, critical: list.filter((h) => h.band === "CRITICAL").length, high: list.filter((h) => h.band === "HIGH").length, worst: list[0] ?? null };
}

// ── gauntlet ──────────────────────────────────────────────────────────────────
export interface RiskGauntlet { score: 0 | 100; checks: Array<{ name: string; pass: boolean; detail: string }> }
export function riskGauntlet(): RiskGauntlet {
  // chargeWallet: sole writer to wallet (SENSITIVE), reached by an endpoint, UNTESTED → top CRITICAL hotspot
  const files: SourceFile[] = [
    { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Log { id Int @id }" },
    { path: "pay.ts", content: "export function pay(req,res){ return chargeWallet(req.uid); }\nexport function chargeWallet(uid){ return prisma.wallet.update({where:{uid},data:{}}); }\nexport function logIt(){ return prisma.log.create({data:{}}); }" },
    { path: "routes.ts", content: "router.post(\"/pay\", pay);" },
  ];
  const hs = riskHotspots(files);
  const top = hs[0];
  const topOK = !!top && top.name === "chargeWallet" && top.band === "CRITICAL" && top.factors.some((f) => /untested/.test(f)) && top.factors.some((f) => /SENSITIVE/.test(f));
  const sum = riskSummary(hs); const sumOK = sum.critical >= 1 && sum.worst?.name === "chargeWallet";
  // adding a test for chargeWallet drops its score (no longer untested)
  const withTest = riskHotspots([...files, { path: "pay.test.ts", content: "test('c', () => chargeWallet(1));" }]);
  const ws = withTest.find((h) => h.name === "chargeWallet");
  const dropsOK = !!ws && !ws.factors.some((f) => /untested/.test(f)) && ws.score < top.score;
  const total = (() => { try { riskHotspots(null as never); riskSummary(null as never); return true; } catch { return false; } })();
  const checks = [
    { name: "TOP-HOTSPOT", pass: topOK, detail: "an untested keystone writing a sensitive table ranks CRITICAL #1, with every factor shown" },
    { name: "SUMMARY", pass: sumOK, detail: "rollup: critical/high counts + the worst hotspot" },
    { name: "RESPONDS-TO-TESTS", pass: dropsOK, detail: "add a test → the 'untested' factor + score drop (the fusion reflects real signals)" },
    { name: "TOTAL", pass: total, detail: "null/garbage never throws" },
  ];
  return { score: checks.every((c) => c.pass) ? 100 : 0, checks };
}
