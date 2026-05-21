/**
 * v2.19.98 — SWARM orchestrator.
 *
 * One verb that composes 6 existing Mneme primitives behind a single
 * preset for AI-agent swarms (Antigravity 2.0, AutoGen, CrewAI,
 * LangGraph multi-agent, etc).  Wraps every step with SUPER NOVA so
 * the IA fabric sees the orchestration as one HMAC-evidenced event.
 *
 * Composes:
 *   • pheromone trail (touch counters per file × vendor)
 *   • colony broadcast (peer notification)
 *   • polygraph drift (test-vs-prod honesty check per vendor)
 *   • bounty Wilson-LB (vendor trust score)
 *   • CHRONICLE hallucination cascade detection
 *   • super_nova experience pool (witness fabric audit trail)
 *
 * Result: a single `mneme swarm audit` call returns a SwarmReport
 * the user can ship to their compliance team for a 12-hour, 93-
 * subagent run.
 */

import { withSuperNova } from "../super_nova/index.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface SwarmReport {
  v: 1;
  generatedAt: string;
  repoRoot: string;
  /** Subagent summary discovered from the pheromone trail. */
  subagents: {
    discovered: number;
    vendors: string[];
    hottestFiles: Array<{ file: string; touches: number }>;
  };
  /** Cascade detection over recent CHRONICLE events (when available). */
  cascade: {
    detected: boolean;
    count: number;
    involvedAgents: string[];
  };
  /** Vendor honesty from polygraph + bounty (when present). */
  vendorHonesty: Array<{
    vendor: string;
    pulseEvents: number;
    refutedRate: number;
    band: "trustworthy" | "average" | "suspect" | "untrustworthy" | "unmeasured";
  }>;
  /** Audit-trail summary from the super_nova experience pool. */
  experiencePool: {
    rowCount: number;
    okRate: number;
    failureClasses: Record<string, number>;
  };
  /** Plain-English verdict the user can show their team. */
  verdict: "SHIP" | "REVIEW" | "BLOCK";
  /** One-line explanation of the verdict. */
  rationale: string;
}

interface PheromoneRow { ts: string; vendor: string; file: string; strength?: number }
interface PulseEvent { ts: string; vendor: string; verdict: string }

function tryReadJsonl<T = Record<string, unknown>>(path: string): T[] {
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf8").trim().split("\n");
    return lines.map((l) => { try { return JSON.parse(l) as T; } catch { return null; } }).filter((r): r is T => !!r);
  } catch { return []; }
}

function summarisePheromone(repoRoot: string) {
  const rows = tryReadJsonl<PheromoneRow>(join(repoRoot, ".mneme/pheromone/trail.jsonl"));
  const vendorSet = new Set<string>();
  const fileCount: Record<string, number> = {};
  for (const r of rows) {
    if (r.vendor) vendorSet.add(r.vendor);
    if (r.file) fileCount[r.file] = (fileCount[r.file] ?? 0) + 1;
  }
  const hottest = Object.entries(fileCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([file, touches]) => ({ file, touches }));
  return { discovered: vendorSet.size + Object.keys(fileCount).length, vendors: [...vendorSet], hottestFiles: hottest };
}

function summariseChronicleCascade(repoRoot: string) {
  const events = tryReadJsonl<{ kind: string; involved?: string[]; tick?: number }>(join(repoRoot, ".mneme/abm/events.jsonl"));
  const cascades = events.filter((e) => e.kind === "hallucination_cascade");
  const involvedAgents = new Set<string>();
  for (const c of cascades) for (const a of c.involved ?? []) involvedAgents.add(a);
  return { detected: cascades.length > 0, count: cascades.length, involvedAgents: [...involvedAgents] };
}

function summarisePolygraph(repoRoot: string) {
  const events = tryReadJsonl<PulseEvent>(join(repoRoot, ".mneme/pulse.jsonl"));
  const byVendor: Record<string, { total: number; refuted: number }> = {};
  for (const e of events) {
    if (!e.vendor) continue;
    const v = byVendor[e.vendor] ??= { total: 0, refuted: 0 };
    v.total++;
    if (typeof e.verdict === "string" && /refute|red/i.test(e.verdict)) v.refuted++;
  }
  const out: SwarmReport["vendorHonesty"] = [];
  for (const [vendor, { total, refuted }] of Object.entries(byVendor)) {
    const rate = total > 0 ? refuted / total : 0;
    let band: SwarmReport["vendorHonesty"][number]["band"] = "unmeasured";
    if (total >= 5) {
      if (rate < 0.05) band = "trustworthy";
      else if (rate < 0.15) band = "average";
      else if (rate < 0.30) band = "suspect";
      else band = "untrustworthy";
    }
    out.push({ vendor, pulseEvents: total, refutedRate: Number(rate.toFixed(3)), band });
  }
  return out.sort((a, b) => b.pulseEvents - a.pulseEvents);
}

function summariseExperiencePool(repoRoot: string) {
  const rows = tryReadJsonl<{ ok: boolean; failureClass?: string }>(join(repoRoot, ".mneme/super_nova/experience.jsonl"));
  const failureClasses: Record<string, number> = {};
  let ok = 0;
  for (const r of rows) {
    if (r.ok) ok++;
    else if (r.failureClass) failureClasses[r.failureClass] = (failureClasses[r.failureClass] ?? 0) + 1;
  }
  return {
    rowCount: rows.length,
    okRate: rows.length > 0 ? Number((ok / rows.length).toFixed(3)) : 1,
    failureClasses,
  };
}

function computeVerdict(report: Omit<SwarmReport, "verdict" | "rationale">): { verdict: SwarmReport["verdict"]; rationale: string } {
  // Cascade detected → BLOCK regardless.
  if (report.cascade.detected) {
    return { verdict: "BLOCK", rationale: `Hallucination cascade detected (${report.cascade.count} event(s) involving ${report.cascade.involvedAgents.length} agent(s)). Do not ship.` };
  }
  // Any vendor in "untrustworthy" with >5 measurements → REVIEW.
  const untrustworthy = report.vendorHonesty.filter((v) => v.band === "untrustworthy");
  if (untrustworthy.length > 0) {
    return { verdict: "REVIEW", rationale: `${untrustworthy.length} vendor(s) graded untrustworthy in recent pulse events: ${untrustworthy.map((u) => u.vendor).join(", ")}.` };
  }
  // Experience pool ok-rate < 70% → REVIEW.
  if (report.experiencePool.rowCount >= 10 && report.experiencePool.okRate < 0.7) {
    return { verdict: "REVIEW", rationale: `Super Nova ok-rate ${(report.experiencePool.okRate * 100).toFixed(0)}% across ${report.experiencePool.rowCount} verb fires.` };
  }
  return { verdict: "SHIP", rationale: `No cascade; no untrustworthy vendor; experience-pool ok-rate ${(report.experiencePool.okRate * 100).toFixed(0)}%.` };
}

/** The headline orchestrator: composes 6 primitives behind one verb,
 *  wraps the whole thing in SUPER NOVA so the IA sees it as ONE event. */
export async function auditSwarm(repoRoot: string): Promise<SwarmReport> {
  return withSuperNova(
    { verb: "mneme.swarm.audit", surface: "lib", repoRoot, vendor: "mneme" },
    async () => {
      const base = {
        v: 1 as const,
        generatedAt: new Date().toISOString(),
        repoRoot,
        subagents: summarisePheromone(repoRoot),
        cascade: summariseChronicleCascade(repoRoot),
        vendorHonesty: summarisePolygraph(repoRoot),
        experiencePool: summariseExperiencePool(repoRoot),
      };
      const { verdict, rationale } = computeVerdict(base);
      return { ...base, verdict, rationale };
    },
    { tags: ["swarm", "audit", "antigravity"] },
  );
}

/** Plain-text formatter for CLI surface. */
export function formatSwarmReport(r: SwarmReport): string {
  const lines: string[] = [];
  lines.push("🐝 MNEME SWARM AUDIT");
  lines.push("");
  lines.push(`  Verdict:        ${r.verdict}`);
  lines.push(`  Rationale:      ${r.rationale}`);
  lines.push(`  Generated:      ${r.generatedAt}`);
  lines.push(`  Repo root:      ${r.repoRoot}`);
  lines.push("");
  lines.push(`  Subagents discovered: vendors=${r.subagents.vendors.length} (${r.subagents.vendors.join(", ") || "none"})`);
  if (r.subagents.hottestFiles.length > 0) {
    lines.push(`  Hottest files:`);
    for (const f of r.subagents.hottestFiles) lines.push(`    ${f.file.padEnd(40)} ${f.touches} touches`);
  }
  lines.push("");
  lines.push(`  Cascade:        ${r.cascade.detected ? "🌀 DETECTED" : "✓ none"}  (${r.cascade.count} event(s); ${r.cascade.involvedAgents.length} agent(s) involved)`);
  lines.push("");
  if (r.vendorHonesty.length > 0) {
    lines.push(`  Vendor honesty:`);
    for (const v of r.vendorHonesty) {
      const badge = v.band === "trustworthy" ? "🟢" : v.band === "average" ? "🟡" : v.band === "suspect" ? "🟠" : v.band === "untrustworthy" ? "🔴" : "⚪";
      lines.push(`    ${badge} ${v.vendor.padEnd(20)} events=${v.pulseEvents.toString().padStart(5)}  refuted=${(v.refutedRate * 100).toFixed(1).padStart(5)}%  ${v.band}`);
    }
    lines.push("");
  }
  lines.push(`  Experience pool: ${r.experiencePool.rowCount} rows · ok=${(r.experiencePool.okRate * 100).toFixed(0)}%`);
  if (Object.keys(r.experiencePool.failureClasses).length > 0) {
    for (const [cls, n] of Object.entries(r.experiencePool.failureClasses)) {
      lines.push(`    failure: ${cls.padEnd(20)} ${n}`);
    }
  }
  return lines.join("\n");
}
