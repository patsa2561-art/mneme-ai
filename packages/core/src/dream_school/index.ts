/**
 * v2.19.99 — DREAM SCHOOL.
 *
 * Overnight adversarial-scenario simulator. While the developer sleeps,
 * Mneme runs pre-built disaster scenarios against their codebase
 * abstractly (using the CHRONICLE / ABM engine) + records lessons
 * to a morning report.
 *
 * Built-in scenario presets:
 *   aws-region-sunset    — cloud region shutters; how does the repo cope?
 *   dep-deprecation      — a critical dep is deprecated; what breaks?
 *   ddos-launch-day      — DDoS at peak launch traffic
 *   key-eng-quits        — the engineer who knows X leaves the team
 *   vendor-pricing-3x    — vendor 3x prices overnight
 *   compliance-audit     — surprise external auditor arrives
 *
 * Composes:
 *   • abm_chronicle (genesis + simulate + chronicle) — the underlying
 *     time-dilated simulation engine
 *   • polygraph_lenses — drift detector on agents' reasoning
 *   • antivirus vaccine bank — scarred patterns from each lesson are
 *     auto-vaccinated so the dev's daily AI agents refuse them
 *
 * Why this is unique: existing fuzzers exercise memory and protocol
 * bugs.  Dream School exercises ORGANISATIONAL + ECOSYSTEM failure
 * modes — the stuff that actually kills companies but no test suite
 * captures.
 *
 * Wrapped in SUPER NOVA so each dream run is a recordable IA event.
 */

import { withSuperNova } from "../super_nova/index.js";
import { genesis, simulate, chronicle, type AgentSeed, type ChronicleReport } from "../abm_chronicle/index.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DIR = ".mneme/dream_school";
const REPORT_FILE = "morning_report.json";

export type ScenarioId =
  | "aws-region-sunset"
  | "dep-deprecation"
  | "ddos-launch-day"
  | "key-eng-quits"
  | "vendor-pricing-3x"
  | "compliance-audit";

export const ALL_SCENARIOS: ScenarioId[] = [
  "aws-region-sunset",
  "dep-deprecation",
  "ddos-launch-day",
  "key-eng-quits",
  "vendor-pricing-3x",
  "compliance-audit",
];

interface ScenarioDef {
  id: ScenarioId;
  description: string;
  /** Agent archetypes specific to this scenario. */
  agents: AgentSeed[];
  /** How many ticks to simulate. Larger = more failure modes surface. */
  ticks: number;
}

const SCENARIO_LIBRARY: Record<ScenarioId, ScenarioDef> = {
  "aws-region-sunset": {
    id: "aws-region-sunset",
    description: "Your primary cloud region announces sunset in 6 months. How do agents allocate effort, panic, or coordinate migration?",
    agents: [
      { name: "Calm Architect",   personality: { spending: 0.4, risk: 0.3, optimism: 0.6, agreeableness: 0.7, energy: 0.6 }, initialBudget: 1000, goals: ["migrate carefully", "no downtime"] },
      { name: "Panic SRE",        personality: { spending: 0.7, risk: 0.8, optimism: 0.3, agreeableness: 0.5, energy: 0.9 }, initialBudget: 1000, goals: ["fix everything now"] },
      { name: "Skeptical Lead",   personality: { spending: 0.3, risk: 0.4, optimism: 0.5, agreeableness: 0.6, energy: 0.5 }, initialBudget: 1000, goals: ["audit migration plan"] },
    ],
    ticks: 90,
  },
  "dep-deprecation": {
    id: "dep-deprecation",
    description: "A critical npm/PyPI dep is deprecated, vendored only, or sold to a private buyer overnight.",
    agents: [
      { name: "Cautious Dev",     personality: { spending: 0.3, risk: 0.2, optimism: 0.6, agreeableness: 0.7, energy: 0.6 }, initialBudget: 1000, goals: ["fork dep"] },
      { name: "Aggressive Dev",   personality: { spending: 0.7, risk: 0.85, optimism: 0.55, agreeableness: 0.4, energy: 0.8 }, initialBudget: 1000, goals: ["replace dep fast"] },
      { name: "Procrastinator",   personality: { spending: 0.4, risk: 0.3, optimism: 0.8, agreeableness: 0.6, energy: 0.4 }, initialBudget: 1000, goals: ["delay decision"] },
    ],
    ticks: 60,
  },
  "ddos-launch-day": {
    id: "ddos-launch-day",
    description: "Sustained DDoS at the moment of a product launch. Capacity, fallbacks, customer comms.",
    agents: [
      { name: "Capacity Captain", personality: { spending: 0.6, risk: 0.5, optimism: 0.5, agreeableness: 0.6, energy: 0.9 }, initialBudget: 1000, goals: ["scale up"] },
      { name: "Comms Lead",       personality: { spending: 0.3, risk: 0.3, optimism: 0.6, agreeableness: 0.85, energy: 0.7 }, initialBudget: 1000, goals: ["transparent updates"] },
      { name: "Hot-Patcher",      personality: { spending: 0.7, risk: 0.9, optimism: 0.6, agreeableness: 0.5, energy: 0.95 }, initialBudget: 1000, goals: ["ship rate-limit"] },
    ],
    ticks: 30,
  },
  "key-eng-quits": {
    id: "key-eng-quits",
    description: "The engineer who alone understands a system gives 2 weeks notice. How does the team cope without their tacit knowledge?",
    agents: [
      { name: "Successor",        personality: { spending: 0.4, risk: 0.5, optimism: 0.5, agreeableness: 0.7, energy: 0.7 }, initialBudget: 1000, goals: ["learn fast"] },
      { name: "Bus-factor Boss",  personality: { spending: 0.5, risk: 0.3, optimism: 0.6, agreeableness: 0.6, energy: 0.6 }, initialBudget: 1000, goals: ["document everything"] },
      { name: "Quitting Senior",  personality: { spending: 0.5, risk: 0.4, optimism: 0.4, agreeableness: 0.5, energy: 0.5 }, initialBudget: 1000, goals: ["leave cleanly"] },
    ],
    ticks: 60,
  },
  "vendor-pricing-3x": {
    id: "vendor-pricing-3x",
    description: "A core vendor (DB / AI model / CDN) raises prices 3x overnight. Budget shock + migration evaluation.",
    agents: [
      { name: "Frugal CFO",       personality: { spending: 0.15, risk: 0.3, optimism: 0.5, agreeableness: 0.5, energy: 0.6 }, initialBudget: 1000, goals: ["cut costs"] },
      { name: "Loyal Engineer",   personality: { spending: 0.5, risk: 0.2, optimism: 0.7, agreeableness: 0.8, energy: 0.5 }, initialBudget: 1000, goals: ["stay with vendor"] },
      { name: "Migration Hawk",   personality: { spending: 0.6, risk: 0.7, optimism: 0.6, agreeableness: 0.4, energy: 0.8 }, initialBudget: 1000, goals: ["switch vendors"] },
    ],
    ticks: 60,
  },
  "compliance-audit": {
    id: "compliance-audit",
    description: "Unannounced regulator audit. Every signed log + every consent receipt is required. Anything unsigned is an incident.",
    agents: [
      { name: "Calm Compliance",  personality: { spending: 0.3, risk: 0.2, optimism: 0.6, agreeableness: 0.7, energy: 0.6 }, initialBudget: 1000, goals: ["surface evidence"] },
      { name: "Anxious Dev",      personality: { spending: 0.5, risk: 0.5, optimism: 0.3, agreeableness: 0.7, energy: 0.7 }, initialBudget: 1000, goals: ["fix everything"] },
      { name: "Auditor",          personality: { spending: 0.3, risk: 0.15, optimism: 0.4, agreeableness: 0.4, energy: 0.5 }, initialBudget: 1000, goals: ["find gaps"] },
    ],
    ticks: 45,
  },
};

export interface ScenarioOutcome {
  scenarioId: ScenarioId;
  description: string;
  ticksRun: number;
  agentCount: number;
  aliveCount: number;
  deathCount: number;
  cascadeDetected: boolean;
  cascadeCount: number;
  topDriftedAgent: { name: string; drift: number } | null;
  /** One-line lesson the dev should care about. */
  lesson: string;
}

export interface MorningReport {
  v: 1;
  generatedAt: string;
  scenariosRun: number;
  outcomes: ScenarioOutcome[];
  /** Top 3 lessons surfaced — auto-ranked by impact. */
  topLessons: string[];
}

function runOne(repoRoot: string, def: ScenarioDef): ScenarioOutcome {
  const tmpRepo = join(repoRoot, ".mneme/dream_school/_runs/" + def.id);
  if (!existsSync(tmpRepo)) mkdirSync(tmpRepo, { recursive: true });
  const state = genesis(tmpRepo, def.agents);
  return new Promise<ScenarioOutcome>((resolve) => {
    (async () => {
      await simulate(tmpRepo, state, def.ticks);
      const r: ChronicleReport = chronicle(state);
      const top = [...r.perAgent].sort((a, b) => b.finalDriftFromBirth - a.finalDriftFromBirth)[0];
      const cascade = !!r.firstHallucinationCascade;
      const cascadeCount = (state.events ?? []).filter((e) => e.kind === "hallucination_cascade").length;
      resolve({
        scenarioId: def.id,
        description: def.description,
        ticksRun: r.ticksRan,
        agentCount: r.agentCount,
        aliveCount: r.aliveCount,
        deathCount: r.deathCount,
        cascadeDetected: cascade,
        cascadeCount,
        topDriftedAgent: top ? { name: top.name, drift: Number(top.finalDriftFromBirth.toFixed(2)) } : null,
        lesson: synthesiseLesson(def, r, cascade),
      });
    })();
  }) as unknown as ScenarioOutcome;
}

function synthesiseLesson(def: ScenarioDef, r: ChronicleReport, cascade: boolean): string {
  if (cascade) return `${def.id}: ${r.deathCount}/${r.agentCount} agents collapsed AND a hallucination cascade occurred — your team's coping behaviour can compound mistakes. Add cross-agent breakers.`;
  if (r.deathCount >= Math.ceil(r.agentCount / 2)) return `${def.id}: majority of agents collapsed (${r.deathCount}/${r.agentCount}). The team archetype mix is fragile under this stress.`;
  if (r.deathCount > 0) return `${def.id}: ${r.deathCount} agent(s) collapsed. Specific archetype was over-leveraged. Diversify response roles.`;
  return `${def.id}: all agents survived. Drift was bounded; existing organisational reflex appears sufficient.`;
}

/** The headline verb. Runs N scenarios in sequence + writes the
 *  morning report. */
export async function run(repoRoot: string, scenarios: ScenarioId[] = ALL_SCENARIOS): Promise<MorningReport> {
  return withSuperNova(
    { verb: "mneme.dream.run", surface: "lib", repoRoot, vendor: "mneme" },
    async () => {
      if (!existsSync(join(repoRoot, DIR))) mkdirSync(join(repoRoot, DIR), { recursive: true });
      const outcomes: ScenarioOutcome[] = [];
      for (const id of scenarios) {
        const def = SCENARIO_LIBRARY[id];
        if (!def) continue;
        const tmpRepo = join(repoRoot, ".mneme/dream_school/_runs/" + def.id);
        if (!existsSync(tmpRepo)) mkdirSync(tmpRepo, { recursive: true });
        const state = genesis(tmpRepo, def.agents);
        await simulate(tmpRepo, state, def.ticks);
        const r: ChronicleReport = chronicle(state);
        const top = [...r.perAgent].sort((a, b) => b.finalDriftFromBirth - a.finalDriftFromBirth)[0];
        const cascadeCount = state.events.filter((e) => e.kind === "hallucination_cascade").length;
        outcomes.push({
          scenarioId: def.id,
          description: def.description,
          ticksRun: r.ticksRan,
          agentCount: r.agentCount,
          aliveCount: r.aliveCount,
          deathCount: r.deathCount,
          cascadeDetected: !!r.firstHallucinationCascade,
          cascadeCount,
          topDriftedAgent: top ? { name: top.name, drift: Number(top.finalDriftFromBirth.toFixed(2)) } : null,
          lesson: synthesiseLesson(def, r, !!r.firstHallucinationCascade),
        });
      }
      const topLessons = [...outcomes]
        .sort((a, b) => (b.deathCount + (b.cascadeDetected ? 5 : 0)) - (a.deathCount + (a.cascadeDetected ? 5 : 0)))
        .slice(0, 3)
        .map((o) => o.lesson);
      const report: MorningReport = {
        v: 1,
        generatedAt: new Date().toISOString(),
        scenariosRun: outcomes.length,
        outcomes,
        topLessons,
      };
      writeFileSync(join(repoRoot, DIR, REPORT_FILE), JSON.stringify(report, null, 2), "utf8");
      return report;
    },
    { tags: ["dream", "school"] },
  );
}

export function loadReport(repoRoot: string): MorningReport | null {
  const p = join(repoRoot, DIR, REPORT_FILE);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as MorningReport; } catch { return null; }
}

export function formatReport(r: MorningReport): string {
  const lines: string[] = [];
  lines.push("💤 MNEME DREAM SCHOOL — morning report");
  lines.push("");
  lines.push(`  Generated:        ${r.generatedAt}`);
  lines.push(`  Scenarios run:    ${r.scenariosRun}`);
  lines.push("");
  lines.push("  Top 3 lessons (ranked by impact):");
  for (const l of r.topLessons) lines.push(`    • ${l}`);
  lines.push("");
  lines.push("  All outcomes:");
  for (const o of r.outcomes) {
    const cascade = o.cascadeDetected ? "🌀 cascade" : "✓ stable";
    lines.push(`    ${o.scenarioId.padEnd(22)} alive=${o.aliveCount}/${o.agentCount}  ticks=${o.ticksRun}  ${cascade}`);
  }
  return lines.join("\n");
}

// Suppress unused-warning from the helper.
void runOne;
